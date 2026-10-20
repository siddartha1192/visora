import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { LlmConfigModel } from "./models/llm-config.model.js";
import { OrganizationModel, slugify } from "./models/organization.model.js";
import { UserModel } from "./models/user.model.js";
import { WorkspaceModel } from "./models/workspace.model.js";

/**
 * Seeds the LlmConfig collection on first boot using env-var credentials.
 * Runs only when the collection is completely empty so it never overwrites
 * admin-managed records.
 */
export async function seedLlmConfigs(): Promise<void> {
  const count = await LlmConfigModel.countDocuments();
  if (count > 0) return;

  const docs: Array<{
    label: string;
    provider: string;
    apiKey: string;
    chatModel?: string;
    imageModel?: string;
    isActive: boolean;
  }> = [];

  if (env.OPENAI_API_KEY) {
    docs.push({
      label: "OpenAI",
      provider: "openai",
      apiKey: env.OPENAI_API_KEY,
      chatModel: env.OPENAI_TEXT_MODEL,
      imageModel: env.OPENAI_IMAGE_MODEL,
      isActive: true,
    });
  }

  if (docs.length === 0) return;

  await LlmConfigModel.insertMany(docs);
  logger.info({ seeded: docs.length }, "Seeded LLM configs from env vars");
}

/**
 * One-time backfill from the legacy `isAdmin` boolean to the `role` field
 * (root | admin | user) introduced afterwards. Only touches documents that
 * predate `role` — new documents always get `role` from the schema default,
 * so this becomes a no-op once every existing user has been migrated.
 */
export async function migrateUserRoles(): Promise<void> {
  const result = await UserModel.updateMany(
    { role: { $exists: false }, platformRole: { $exists: false } },
    [{ $set: { role: { $cond: [{ $eq: ["$isAdmin", true] }, "admin", "user"] } } }],
  );
  if (result.modifiedCount > 0) {
    logger.info({ migrated: result.modifiedCount }, "Migrated users from isAdmin to role");
  }
}

/** Slug that doesn't collide with an existing organization. */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await OrganizationModel.exists({ slug: candidate }))) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * One-time backfill introducing the Organization (tenant) boundary.
 *
 * Before this, every user got their own workspace 1:1 and a single global
 * `role` decided authorization, so an `admin` could reach every customer's
 * data. Each pre-existing user therefore becomes the OWNER OF THEIR OWN
 * single-brand organization — that is the demotion that closes the
 * cross-customer hole — while the legacy `root` tier becomes `platformRole`.
 *
 * Idempotent: every step is guarded, so it is safe to run on each boot and
 * becomes a no-op once complete.
 *
 * ORDERING: this must run (and be verified) BEFORE ROOT_EMAILS is removed from
 * the environment; otherwise the only platform administrator silently loses
 * privilege with no way back in.
 */
export async function migrateToOrganizations(): Promise<void> {
  const pending = await WorkspaceModel.find({
    $or: [{ organizationId: { $exists: false } }, { organizationId: null }],
  }).lean();

  let orgsCreated = 0;

  // 1. One organization per pre-existing workspace (they were strictly 1:1 with users).
  for (const ws of pending) {
    const owner = ws.ownerId
      ? await UserModel.findById(ws.ownerId).select("name email").lean()
      : null;
    const orgName = owner?.name ? `${owner.name}'s Organization` : ws.name;

    const org = await OrganizationModel.create({
      name: orgName,
      slug: await uniqueSlug(orgName),
      // `plan`/`creditBalance` were inert placeholders on Workspace; defaults apply.
    });
    orgsCreated++;

    await WorkspaceModel.updateOne({ _id: ws._id }, { $set: { organizationId: org._id } });

    // Everyone who was a member of this workspace joins that organization.
    // Legacy membership role "owner" becomes workspace-level "admin"; org-level
    // ownership is expressed by orgRole, not by the membership.
    await UserModel.updateMany(
      { "workspaces.workspaceId": ws._id, organizationId: null },
      { $set: { organizationId: org._id, orgRole: "owner" } },
    );
    await UserModel.updateMany(
      { "workspaces.workspaceId": ws._id, "workspaces.$[m].role": "owner" },
      { $set: { "workspaces.$[m].role": "admin" } },
      { arrayFilters: [{ "m.role": "owner" }] },
    );
  }

  // 2. Legacy `role` → platformRole. ONLY "root" was ever the SaaS operator;
  //    "admin" was a global tier that must NOT survive as platform staff.
  const promoted = await UserModel.updateMany(
    { role: "root", platformRole: null },
    { $set: { platformRole: "root" } },
  );

  // 3. Users with no workspace at all (edge case) still need a tenant, or they
  //    would fail the organizationId validator on their next save.
  const orphans = await UserModel.find({
    organizationId: null,
    platformRole: null,
  }).select("name").lean();
  for (const u of orphans) {
    const orgName = `${u.name}'s Organization`;
    const org = await OrganizationModel.create({ name: orgName, slug: await uniqueSlug(orgName) });
    orgsCreated++;
    await UserModel.updateOne(
      { _id: u._id },
      { $set: { organizationId: org._id, orgRole: "owner" } },
    );
  }

  // 4. Platform staff that predate organizations keep their own org/data
  //    (grandfathered); only newly CLI-created staff are org-less.
  await UserModel.updateMany(
    { platformRole: "root", organizationId: { $ne: null }, orgRole: null },
    { $set: { orgRole: "owner" } },
  );

  if (orgsCreated > 0 || promoted.modifiedCount > 0) {
    logger.info(
      { orgsCreated, platformStaff: promoted.modifiedCount, orphansFixed: orphans.length },
      "Migrated to organization-based tenancy",
    );
  }

  await assertTenancyInvariants();
}

/**
 * Fails loudly at boot if any document escaped the backfill. A user or
 * workspace without a tenant is invisible to org scoping, which is exactly the
 * class of bug this whole migration exists to remove — so it must never be
 * allowed to start serving traffic.
 */
async function assertTenancyInvariants(): Promise<void> {
  const [orphanUsers, orphanWorkspaces] = await Promise.all([
    UserModel.countDocuments({ organizationId: null, platformRole: null }),
    WorkspaceModel.countDocuments({
      $or: [{ organizationId: { $exists: false } }, { organizationId: null }],
    }),
  ]);

  if (orphanUsers > 0 || orphanWorkspaces > 0) {
    throw new Error(
      `Tenancy backfill incomplete: ${orphanUsers} user(s) and ${orphanWorkspaces} workspace(s) have no organization`,
    );
  }

  const platformStaff = await UserModel.countDocuments({ platformRole: "root" });
  if (platformStaff === 0) {
    logger.warn(
      "No platform administrator exists. Create one with: node dist/cli/create-platform-admin.js",
    );
  }
}

/** Exported for the CLI and tenant provisioning so slug generation stays collision-safe. */
export { uniqueSlug };
