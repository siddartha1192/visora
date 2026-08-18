import argon2 from "argon2";
import { Types } from "mongoose";
import type { OrganizationDTO, WorkspaceDTO } from "@visora/shared";
import { PLANS } from "@visora/shared";
import { OrganizationModel, UserModel, WorkspaceModel } from "../../db/models/index.js";
import { uniqueSlug } from "../../db/seed.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";

export function toOrganizationDTO(org: {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  plan?: string;
  creditBalance?: number;
  status?: string;
  createdAt?: Date;
}): OrganizationDTO {
  return {
    id: org._id.toString(),
    name: org.name,
    slug: org.slug,
    plan: org.plan ?? "free",
    creditBalance: org.creditBalance ?? 0,
    status: (org.status ?? "active") as OrganizationDTO["status"],
    createdAt: (org.createdAt ?? new Date()).toISOString(),
  };
}

export function toWorkspaceDTO(
  ws: {
    _id: Types.ObjectId;
    organizationId?: Types.ObjectId | null;
    name: string;
    ownerId?: Types.ObjectId | null;
    createdAt?: Date;
  },
  myRole?: string,
): WorkspaceDTO {
  return {
    id: ws._id.toString(),
    organizationId: ws.organizationId?.toString() ?? "",
    name: ws.name,
    ownerId: ws.ownerId?.toString() ?? null,
    ...(myRole ? { myRole: myRole as WorkspaceDTO["myRole"] } : {}),
    createdAt: (ws.createdAt ?? new Date()).toISOString(),
  };
}

/**
 * Creates a tenant: organization + its single owner + a default workspace, in
 * that order, so the tenant is immediately usable and can never land in a
 * zero-workspace state.
 *
 * This replaces public self-registration as the entry point for a new
 * customer — it is reachable only by platform staff, off the back of a
 * subscription.
 */
export async function provisionTenant(input: {
  organizationName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  workspaceName?: string;
  /** Defaults to Organization's schema default ("free") when omitted — platform-provisioned tenants are upgraded separately. */
  plan?: string;
}): Promise<{ organization: OrganizationDTO; workspace: WorkspaceDTO; ownerId: string }> {
  const email = input.ownerEmail.toLowerCase();
  if (await UserModel.exists({ email })) {
    throw new ConflictError("Email already registered");
  }

  const org = await OrganizationModel.create({
    name: input.organizationName,
    slug: await uniqueSlug(input.organizationName),
    ...(input.plan ? { plan: input.plan } : {}),
  });

  // The owner is created before the workspace so the workspace has a real
  // ownerId; the membership is attached immediately after.
  const owner = await UserModel.create({
    name: input.ownerName,
    email,
    passwordHash: await argon2.hash(input.ownerPassword),
    status: "active",
    organizationId: org._id,
    orgRole: "owner",
    platformRole: null,
  });

  const workspace = await WorkspaceModel.create({
    organizationId: org._id,
    name: input.workspaceName?.trim() || `${input.organizationName} Workspace`,
    ownerId: owner._id,
  });

  owner.workspaces.push({ workspaceId: workspace._id, role: "admin" });
  owner.defaultWorkspaceId = workspace._id;
  await owner.save();

  return {
    organization: toOrganizationDTO(org),
    workspace: toWorkspaceDTO(workspace, "admin"),
    ownerId: owner._id.toHexString(),
  };
}

/**
 * Adds a workspace (a brand/product) to an existing organization. Restricted
 * to the tenant root at the route level; the creator is recorded as owner and
 * granted an admin membership so the workspace is usable immediately.
 */
export async function createWorkspace(input: {
  organizationId: string;
  name: string;
  creatorUserId: string;
}): Promise<WorkspaceDTO> {
  const org = await OrganizationModel.findById(new Types.ObjectId(input.organizationId));
  if (!org) throw new NotFoundError("Organization");

  const creator = await UserModel.findById(new Types.ObjectId(input.creatorUserId));
  if (!creator) throw new NotFoundError("User");

  const planDef = PLANS[org.plan as keyof typeof PLANS];
  if (planDef?.maxWorkspaces != null) {
    const activeCount = await WorkspaceModel.countDocuments({
      organizationId: org._id,
      archivedAt: null,
    });
    if (activeCount >= planDef.maxWorkspaces) {
      throw new ConflictError(
        `Your ${planDef.name} plan allows up to ${planDef.maxWorkspaces} workspace${planDef.maxWorkspaces === 1 ? "" : "s"}. Upgrade to add more.`,
      );
    }
  }

  const workspace = await WorkspaceModel.create({
    organizationId: org._id,
    name: input.name,
    ownerId: creator._id,
  });

  const already = creator.workspaces.some(
    (w) => w.workspaceId.toString() === workspace._id.toString(),
  );
  if (!already) {
    creator.workspaces.push({ workspaceId: workspace._id, role: "admin" });
    if (!creator.defaultWorkspaceId) creator.defaultWorkspaceId = workspace._id;
    await creator.save();
  }

  return toWorkspaceDTO(workspace, "admin");
}

/** Workspaces in an organization, newest first. */
export async function listWorkspacesForOrg(
  organizationId: string,
  memberships: Map<string, string>,
): Promise<WorkspaceDTO[]> {
  if (!Types.ObjectId.isValid(organizationId)) return [];
  const rows = await WorkspaceModel.find({
    organizationId: new Types.ObjectId(organizationId),
    archivedAt: null,
  })
    .sort({ createdAt: -1 })
    .lean();
  return rows.map((w) =>
    toWorkspaceDTO(
      w as Parameters<typeof toWorkspaceDTO>[0],
      memberships.get((w._id as Types.ObjectId).toString()),
    ),
  );
}

export async function renameWorkspace(
  workspaceId: string,
  organizationId: string,
  name: string,
): Promise<WorkspaceDTO> {
  const ws = await WorkspaceModel.findOneAndUpdate(
    {
      _id: new Types.ObjectId(workspaceId),
      organizationId: new Types.ObjectId(organizationId),
    },
    { $set: { name } },
    { new: true },
  );
  if (!ws) throw new NotFoundError("Workspace");
  return toWorkspaceDTO(ws);
}

/**
 * Soft-archives a workspace. Deliberately not a hard delete: posts, assets and
 * agent logs reference it, and the audit trail should survive. The last active
 * workspace in an organization cannot be archived, or the tenant would be left
 * with nowhere to work.
 */
export async function archiveWorkspace(
  workspaceId: string,
  organizationId: string,
): Promise<WorkspaceDTO> {
  const remaining = await WorkspaceModel.countDocuments({
    organizationId: new Types.ObjectId(organizationId),
    archivedAt: null,
  });
  if (remaining <= 1) {
    throw new ConflictError("An organization must keep at least one active workspace");
  }

  const ws = await WorkspaceModel.findOneAndUpdate(
    {
      _id: new Types.ObjectId(workspaceId),
      organizationId: new Types.ObjectId(organizationId),
      archivedAt: null,
    },
    { $set: { archivedAt: new Date() } },
    { new: true },
  );
  if (!ws) throw new NotFoundError("Workspace");
  return toWorkspaceDTO(ws);
}
