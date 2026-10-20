import argon2 from "argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Model } from "mongoose";
import { Types } from "mongoose";
import type { WorkspaceRole } from "@visora/shared";
import {
  AgentLogModel,
  AssetModel,
  JobModel,
  LlmConfigModel,
  NodeConfigModel,
  OrganizationModel,
  PostModel,
  UserModel,
  WorkspaceModel,
} from "../../db/models/index.js";
import { createContainer } from "../../config/container.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { cancelPost } from "../../modules/posts/post.service.js";
import { removeScheduledPublish } from "../../queue/post-queue.js";
import * as apiKeyService from "../../modules/workspace/api-key.service.js";
import { workspaceIdsForOrg } from "../middleware/auth.js";
import { ok, created } from "../reply.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskApiKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return "sk-••••••••" + key.slice(-4);
}

function formatUser(u: InstanceType<typeof UserModel>) {
  return {
    id: u._id.toHexString(),
    name: u.name,
    email: u.email,
    status: u.status,
    organizationId: u.organizationId?.toString() ?? null,
    orgRole: u.orgRole ?? null,
    platformRole: u.platformRole ?? null,
    workspaces: u.workspaces.map((w) => ({
      workspaceId: w.workspaceId.toString(),
      role: w.role,
    })),
    workspaceCount: u.workspaces.length,
    lastLoginAt: u.lastLoginAt ?? null,
    createdAt: (u as unknown as { createdAt: Date }).createdAt,
  };
}

// ── Tenant scoping helpers ────────────────────────────────────────────────────

/**
 * Workspaces whose users the caller may see and manage.
 *
 * The tenant root covers their whole organization; a workspace admin covers
 * only the workspaces they actually administer — that boundary is what stops
 * one brand's admin from reaching another brand's people.
 */
export async function adminableWorkspaceIds(req: FastifyRequest): Promise<Types.ObjectId[]> {
  const auth = req.auth!;
  if (auth.orgRole === "owner") return workspaceIdsForOrg(auth.organizationId);

  const user = await UserModel.findById(new Types.ObjectId(auth.userId))
    .select("workspaces")
    .lean();
  return (user?.workspaces ?? [])
    .filter((w) => w.role === "admin")
    .map((w) => w.workspaceId as Types.ObjectId);
}

/** Mongo filter restricting a User query to what the caller may see. */
async function visibleUsersFilter(req: FastifyRequest): Promise<Record<string, unknown>> {
  const auth = req.auth!;
  // Platform staff support every tenant, so they are deliberately unscoped here.
  if (auth.platformRole === "root") return {};

  const orgFilter = { organizationId: new Types.ObjectId(auth.organizationId) };
  if (auth.orgRole === "owner") return orgFilter;

  const wsIds = await adminableWorkspaceIds(req);
  return { ...orgFilter, "workspaces.workspaceId": { $in: wsIds } };
}

/**
 * Loads a user the caller is allowed to act on, or 404s. Deliberately 404 and
 * not 403: a caller must not be able to probe which user ids exist in another
 * tenant.
 */
async function loadManageableUser(req: FastifyRequest, id: string) {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError("User");
  const filter = await visibleUsersFilter(req);
  const target = await UserModel.findOne({ ...filter, _id: new Types.ObjectId(id) });
  if (!target) throw new NotFoundError("User");
  return target;
}

/**
 * Workspace ids whose CONTENT (posts, assets, keys, usage) the caller may see.
 * Broader than `adminableWorkspaceIds`: viewing a workspace's posts only needs
 * a membership, not an admin one.
 *
 * Returns `null` for platform staff, meaning "unrestricted" — callers must
 * treat null as skip-the-filter rather than as an empty set.
 */
async function visibleWorkspaceIds(req: FastifyRequest): Promise<Types.ObjectId[] | null> {
  const auth = req.auth!;
  if (auth.platformRole === "root") return null;
  if (auth.orgRole === "owner") return workspaceIdsForOrg(auth.organizationId);

  const user = await UserModel.findById(new Types.ObjectId(auth.userId))
    .select("workspaces")
    .lean();
  return (user?.workspaces ?? []).map((w) => w.workspaceId as Types.ObjectId);
}

function formatLlmConfig(cfg: InstanceType<typeof LlmConfigModel>) {
  return {
    id: cfg._id.toHexString(),
    label: cfg.label,
    provider: cfg.provider,
    apiKeyMasked: maskApiKey(cfg.apiKey),
    chatModel: cfg.chatModel ?? null,
    imageModel: cfg.imageModel ?? null,
    isActive: cfg.isActive,
    createdAt: (cfg as unknown as { createdAt: Date }).createdAt,
  };
}

// ── Admin "me" ────────────────────────────────────────────────────────────────

export async function adminMe(req: FastifyRequest, reply: FastifyReply) {
  const user = await UserModel.findById(new Types.ObjectId(req.auth!.userId));
  if (!user) throw new NotFoundError("User");

  const org = user.organizationId
    ? await OrganizationModel.findById(user.organizationId).lean()
    : null;

  return ok(reply, {
    id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    orgRole: user.orgRole ?? null,
    platformRole: user.platformRole ?? null,
    organization: org
      ? { id: org._id.toString(), name: org.name, slug: org.slug }
      : null,
  });
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function listUsers(req: FastifyRequest, reply: FastifyReply) {
  const filter = await visibleUsersFilter(req);
  const users = await UserModel.find(filter).sort({ createdAt: -1 });
  return ok(reply, users.map(formatUser));
}

/**
 * Provisions a user INTO the caller's own organization and grants them a
 * membership on one workspace. Replaces the pre-tenancy behaviour of minting a
 * fresh workspace per user, which is what made every account an island.
 *
 * The tenant root may target any workspace in their org; a workspace admin may
 * target only workspaces they themselves administer.
 */
export async function createUser(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.auth!;
  const { name, email, password, workspaceId, workspaceRole = "editor" } = req.body as {
    name: string;
    email: string;
    password: string;
    workspaceId: string;
    workspaceRole?: WorkspaceRole;
  };

  if (workspaceRole === "owner") {
    throw new BadRequestError("Use 'admin' for workspace administrators");
  }
  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new BadRequestError("A valid workspaceId is required");
  }

  // The caller must administer the target workspace. Platform staff are exempt
  // (they provision on a customer's behalf) but still need a real workspace.
  const allowed = await adminableWorkspaceIds(req);
  const targetWs = await WorkspaceModel.findById(new Types.ObjectId(workspaceId));
  if (!targetWs) throw new NotFoundError("Workspace");
  if (
    auth.platformRole !== "root" &&
    !allowed.some((w) => w.toString() === workspaceId)
  ) {
    throw new ForbiddenError("You do not administer that workspace");
  }

  const existing = await UserModel.findOne({ email: email.toLowerCase() });
  if (existing) throw new ConflictError("Email already registered");

  const passwordHash = await argon2.hash(password);
  const user = await UserModel.create({
    name,
    email: email.toLowerCase(),
    passwordHash,
    status: "active",
    // The new user joins the WORKSPACE's organization, never the caller's by
    // assumption — those coincide for customers but not for platform staff.
    organizationId: targetWs.organizationId,
    orgRole: "member",
    platformRole: null,
    workspaces: [{ workspaceId: targetWs._id, role: workspaceRole }],
    defaultWorkspaceId: targetWs._id,
  });

  return created(reply, formatUser(user));
}

/**
 * Status changes and workspace-role changes, scoped to what the caller may
 * manage. Org-level role (`orgRole`) is deliberately not editable here — tenant
 * ownership transfer is a separate, deliberate action.
 */
export async function updateUser(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const patch = req.body as Partial<{ status: string; workspaceRole: WorkspaceRole }>;
  const auth = req.auth!;

  const target = await loadManageableUser(req, id);

  // Nobody may edit the tenant root except platform staff — otherwise a
  // workspace admin could suspend the person who administers them.
  if (target.orgRole === "owner" && auth.platformRole !== "root") {
    throw new ForbiddenError("Only platform staff can modify the organization owner");
  }
  if (target.platformRole === "root" && auth.platformRole !== "root") {
    throw new ForbiddenError("Only platform staff can modify a platform account");
  }
  if (id === auth.userId && patch.status !== undefined) {
    throw new BadRequestError("Cannot change your own status");
  }

  if (patch.status !== undefined) target.status = patch.status as typeof target.status;

  if (patch.workspaceRole !== undefined) {
    if (patch.workspaceRole === "owner") {
      throw new BadRequestError("Use 'admin' for workspace administrators");
    }
    const allowed = await adminableWorkspaceIds(req);
    const editable = target.workspaces.filter((m) =>
      auth.platformRole === "root"
        ? true
        : allowed.some((w) => w.toString() === m.workspaceId.toString()),
    );
    if (editable.length === 0) {
      throw new ForbiddenError("You do not administer any of that user's workspaces");
    }
    for (const m of editable) m.role = patch.workspaceRole;
  }

  await target.save();
  return ok(reply, formatUser(target));
}

export async function deleteUser(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const auth = req.auth!;
  if (id === auth.userId) throw new BadRequestError("Cannot delete your own account");

  const target = await loadManageableUser(req, id);

  if (target.orgRole === "owner" && auth.platformRole !== "root") {
    throw new ForbiddenError("Only platform staff can delete the organization owner");
  }
  if (target.platformRole === "root" && auth.platformRole !== "root") {
    throw new ForbiddenError("Only platform staff can delete a platform account");
  }

  await target.deleteOne();
  return ok(reply, { deleted: id });
}

// ── Posts ─────────────────────────────────────────────────────────────────────

export async function listAllPosts(req: FastifyRequest, reply: FastifyReply) {
  const { page = 1, pageSize = 30, status, q } = req.query as {
    page?: number; pageSize?: number; status?: string; q?: string;
  };
  const safeSize = Math.min(Number(pageSize), 50);
  const safePage = Math.max(Number(page), 1);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {};

  // Tenant scope FIRST — without it this free-text search reaches into every
  // customer's briefs and prompts, and mints signed URLs for their images.
  const scopeWsIds = await visibleWorkspaceIds(req);
  if (scopeWsIds !== null) filter.workspaceId = { $in: scopeWsIds };

  if (status) filter.status = status;
  if (q) filter.$or = [
    { "input.prompt": { $regex: q, $options: "i" } },
    { "input.brief": { $regex: q, $options: "i" } },
    { "input.instructions": { $regex: q, $options: "i" } },
  ];

  const [posts, total] = await Promise.all([
    PostModel.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeSize).limit(safeSize).lean(),
    PostModel.countDocuments(filter),
  ]);

  // Batch-resolve workspace → user (email + name) for display.
  // Users have a workspaces[] array of memberships; match on workspaces.workspaceId.
  const postWsIds = [...new Set(posts.map((p) => p.workspaceId.toString()))];
  const wsObjectIds = postWsIds.map((id) => new Types.ObjectId(id));
  const users = await UserModel.find({ "workspaces.workspaceId": { $in: wsObjectIds } })
    .select("workspaces email name")
    .lean();
  // Map each workspaceId to the first user that has that workspace membership
  const wsToUser = new Map<string, { email: string; name: string }>();
  for (const u of users) {
    for (const m of u.workspaces ?? []) {
      const wsId = (m as { workspaceId: Types.ObjectId }).workspaceId.toString();
      if (!wsToUser.has(wsId)) wsToUser.set(wsId, { email: u.email, name: u.name });
    }
  }

  // Batch-resolve thumbnails the same way as owners above. Signed here rather
  // than letting the client call GET /assets/:id per row: that endpoint is
  // workspace-scoped, so an admin would 404 on every post outside their own
  // workspace — and one page would fire 30 requests.
  const assetIds = posts
    .map((p) => p.primaryAssetId)
    .filter((id): id is Types.ObjectId => Boolean(id));
  const thumbs = new Map<string, string>();
  if (assetIds.length > 0) {
    const assets = await AssetModel.find({ _id: { $in: assetIds } })
      .select("s3")
      .lean();
    const services = createContainer();
    await Promise.all(
      assets.map(async (a) => {
        const key = (a as { s3?: { key?: string } }).s3?.key;
        if (!key) return;
        try {
          thumbs.set(
            (a._id as Types.ObjectId).toString(),
            await services.objectStore.signedUrl(key),
          );
        } catch {
          // A missing object shouldn't blank the whole listing.
        }
      }),
    );
  }

  const items = posts.map((p) => {
    const owner = wsToUser.get(p.workspaceId.toString());
    return {
      id: (p._id as Types.ObjectId).toString(),
      workspaceId: p.workspaceId.toString(),
      ownerEmail: owner?.email ?? "—",
      ownerName: owner?.name ?? "—",
      workflow: p.workflow,
      status: p.status,
      brief: (p.input as Record<string, string | undefined>)?.brief ?? undefined,
      prompt: (p.input as Record<string, string | undefined>)?.prompt ?? undefined,
      instructions: (p.input as Record<string, string | undefined>)?.instructions ?? undefined,
      sourceUrl: (p.input as Record<string, string | undefined>)?.sourceUrl ?? undefined,
      platforms: (p.targets ?? []).map((t: { platform: string }) => t.platform),
      primaryAssetId: p.primaryAssetId?.toString(),
      imageUrl: p.primaryAssetId ? thumbs.get(p.primaryAssetId.toString()) : undefined,
      lastError: p.lastError ?? undefined,
      cancelledAt: (p as unknown as { cancelledAt?: Date }).cancelledAt?.toISOString(),
      createdAt: (p as unknown as { createdAt: Date }).createdAt.toISOString(),
    };
  });

  return ok(reply, { items, total, page: safePage, pageSize: safeSize });
}

/**
 * Loads a post the caller is allowed to act on, returning its workspace id.
 * 404s rather than 403s so a caller cannot probe which post ids exist in
 * another tenant.
 */
async function assertPostInScope(req: FastifyRequest, postId: string): Promise<string> {
  if (!Types.ObjectId.isValid(postId)) throw new NotFoundError("Post");
  const post = await PostModel.findById(new Types.ObjectId(postId)).select("workspaceId").lean();
  if (!post) throw new NotFoundError("Post");

  const wsIds = await visibleWorkspaceIds(req);
  const workspaceId = (post.workspaceId as Types.ObjectId).toString();
  if (wsIds !== null && !wsIds.some((w) => w.toString() === workspaceId)) {
    throw new NotFoundError("Post");
  }
  return workspaceId;
}

/**
 * Cancels a post anywhere the caller can reach — their whole organization for
 * a tenant root, only their own workspaces for a workspace admin, anywhere for
 * platform staff. The post's real workspace is passed through so the service
 * stays workspace-scoped and never needs a null tenant key.
 */
export async function cancelPostAsAdmin(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const workspaceId = await assertPostInScope(req, id);
  return ok(
    reply,
    await cancelPost({
      workspaceId,
      postId: id,
      actor: {
        userId: req.auth!.userId,
        role: req.auth!.platformRole === "root" ? "root" : "admin",
      },
    }),
  );
}

/**
 * Hard-deletes the post record, scoped to workspaces the caller can reach.
 *
 * Drops any pending scheduled-publish job first: without that, deleting a
 * scheduled post leaves a delayed job in Redis that later fires and fails
 * looking for a record that no longer exists.
 */
export async function deletePost(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  await assertPostInScope(req, id);
  await removeScheduledPublish(id);
  const post = await PostModel.findByIdAndDelete(new Types.ObjectId(id));
  if (!post) throw new NotFoundError("Post");
  return ok(reply, { deleted: id });
}

// ── LLM Configs (platform-global — organizationId: null) ───────────────────
// BYOK org-owned configs live in modules/workspace/llm-config.service.ts and
// are never returned here — mixing the two would show one tenant's own key
// inside another tenant-invisible platform list, or let a platform-config
// mutation accidentally touch a tenant's BYOK row.

export async function listLlmConfigs(_req: FastifyRequest, reply: FastifyReply) {
  const configs = await LlmConfigModel.find({ organizationId: null }).sort({ createdAt: -1 });
  return ok(reply, configs.map(formatLlmConfig));
}

export async function createLlmConfig(req: FastifyRequest, reply: FastifyReply) {
  const body = req.body as {
    label: string;
    provider: string;
    apiKey: string;
    chatModel?: string;
    imageModel?: string;
  };
  const cfg = await LlmConfigModel.create({ ...body, organizationId: null });
  return created(reply, formatLlmConfig(cfg));
}

export async function updateLlmConfig(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const patch = req.body as Partial<{
    label: string;
    provider: string;
    apiKey: string;
    chatModel: string;
    imageModel: string;
    isActive: boolean;
  }>;
  const cfg = await LlmConfigModel.findOneAndUpdate(
    { _id: new Types.ObjectId(id), organizationId: null },
    { $set: patch },
    { new: true },
  );
  if (!cfg) throw new NotFoundError("LLM config");
  return ok(reply, formatLlmConfig(cfg));
}

export async function deleteLlmConfig(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const cfg = await LlmConfigModel.findOneAndDelete({ _id: new Types.ObjectId(id), organizationId: null });
  if (!cfg) throw new NotFoundError("LLM config");
  return ok(reply, { deleted: id });
}

// ── Node Config ───────────────────────────────────────────────────────────────

export async function getNodeConfig(_req: FastifyRequest, reply: FastifyReply) {
  const doc = await NodeConfigModel.findOne({ singletonKey: "global" })
    .populate("assignments.planner", "label provider")
    .populate("assignments.caption", "label provider")
    .populate("assignments.generation", "label provider")
    .populate("assignments.enhancement", "label provider");

  const assignments = doc?.assignments ?? {};
  const toRef = (v: unknown) => {
    if (!v) return null;
    const o = v as { _id: Types.ObjectId; label: string; provider: string };
    return { id: o._id.toHexString(), label: o.label, provider: o.provider };
  };

  return ok(reply, {
    assignments: {
      planner:     toRef((assignments as Record<string, unknown>).planner),
      caption:     toRef((assignments as Record<string, unknown>).caption),
      generation:  toRef((assignments as Record<string, unknown>).generation),
      enhancement: toRef((assignments as Record<string, unknown>).enhancement),
    },
  });
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export async function getAnalytics(req: FastifyRequest, reply: FastifyReply) {
  const { range = "30d" } = req.query as { range?: string };

  let dateFrom: Date | null = null;
  const now = Date.now();
  if (range === "7d") dateFrom = new Date(now - 7 * 86_400_000);
  else if (range === "30d") dateFrom = new Date(now - 30 * 86_400_000);
  else if (range === "90d") dateFrom = new Date(now - 90 * 86_400_000);

  // Tenant scope. Both Post and AgentLog carry workspaceId, so the same clause
  // scopes every aggregation below. Without it this endpoint reports every
  // customer's content volume, token spend and per-user emails to any admin.
  const wsIds = await visibleWorkspaceIds(req);
  const scope = wsIds !== null ? { workspaceId: { $in: wsIds } } : {};

  const postFilter = { ...scope, ...(dateFrom ? { createdAt: { $gte: dateFrom } } : {}) };
  const logFilter  = { ...scope, ...(dateFrom ? { createdAt: { $gte: dateFrom } } : {}) };

  type AggDoc = Record<string, unknown>;

  const [postFacet, modelStats, userTokenAgg, userPostAgg, users] = await Promise.all([
    // 1. Post counts grouped by status and workflow
    PostModel.aggregate([
      { $match: postFilter },
      {
        $facet: {
          byStatus:   [{ $group: { _id: "$status",   count: { $sum: 1 } } }, { $sort: { count: -1 } }],
          byWorkflow: [{ $group: { _id: "$workflow",  count: { $sum: 1 } } }, { $sort: { count: -1 } }],
        },
      },
    ]),

    // 2. Token / cost / image totals per model
    AgentLogModel.aggregate([
      { $match: { ...logFilter, "provider.model": { $exists: true, $ne: null } } },
      {
        $group: {
          _id:              { provider: "$provider.name", model: "$provider.model" },
          promptTokens:     { $sum: { $ifNull: ["$usage.promptTokens",     0] } },
          completionTokens: { $sum: { $ifNull: ["$usage.completionTokens", 0] } },
          costUsd:          { $sum: { $ifNull: ["$usage.costUsd",          0] } },
          imagesGenerated:  { $sum: { $ifNull: ["$usage.imagesGenerated",  0] } },
          requests:         { $sum: 1 },
        },
      },
      { $sort: { costUsd: -1 } },
    ]),

    // 3. Per-user token totals  (AgentLog → Post → authorId)
    AgentLogModel.aggregate([
      { $match: logFilter },
      {
        $group: {
          _id:              "$postId",
          promptTokens:     { $sum: { $ifNull: ["$usage.promptTokens",     0] } },
          completionTokens: { $sum: { $ifNull: ["$usage.completionTokens", 0] } },
          costUsd:          { $sum: { $ifNull: ["$usage.costUsd",          0] } },
          imagesGenerated:  { $sum: { $ifNull: ["$usage.imagesGenerated",  0] } },
        },
      },
      { $lookup: { from: "posts", localField: "_id", foreignField: "_id", as: "post" } },
      { $unwind: { path: "$post", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id:              "$post.authorId",
          promptTokens:     { $sum: "$promptTokens"     },
          completionTokens: { $sum: "$completionTokens" },
          costUsd:          { $sum: "$costUsd"          },
          imagesGenerated:  { $sum: "$imagesGenerated"  },
        },
      },
    ]),

    // 4. Per-user post counts broken down by status × workflow
    PostModel.aggregate([
      { $match: postFilter },
      {
        $group: {
          _id:   { userId: "$authorId", status: "$status", workflow: "$workflow" },
          count: { $sum: 1 },
        },
      },
    ]),

    // 5. Minimal user lookup for name + email
    // Name/email lookup for the per-user breakdown — scoped, or it leaks the
    // full customer roster of every other tenant into this response.
    UserModel.find(await visibleUsersFilter(req), { _id: 1, name: 1, email: 1 }).lean(),
  ]);

  // Build lookup maps ──────────────────────────────────────────────────────────
  const userInfoMap = new Map(users.map((u) => [u._id.toHexString(), { name: u.name, email: u.email }]));

  const userTokenMap = new Map<string, { promptTokens: number; completionTokens: number; costUsd: number; imagesGenerated: number }>(
    (userTokenAgg as AggDoc[]).map((u) => [
      String(u._id),
      { promptTokens: Number(u.promptTokens), completionTokens: Number(u.completionTokens), costUsd: Number(u.costUsd), imagesGenerated: Number(u.imagesGenerated) },
    ]),
  );

  const userPostMap = new Map<string, { total: number; byStatus: Record<string, number>; byWorkflow: Record<string, number> }>();
  for (const entry of userPostAgg as AggDoc[]) {
    const uid = String((entry._id as AggDoc).userId);
    if (!userPostMap.has(uid)) userPostMap.set(uid, { total: 0, byStatus: {}, byWorkflow: {} });
    const u = userPostMap.get(uid)!;
    u.total += Number(entry.count);
    const st = String((entry._id as AggDoc).status);
    const wf = String((entry._id as AggDoc).workflow);
    u.byStatus[st] = (u.byStatus[st] ?? 0) + Number(entry.count);
    u.byWorkflow[wf] = (u.byWorkflow[wf] ?? 0) + Number(entry.count);
  }

  const allUids = new Set([...userTokenMap.keys(), ...userPostMap.keys()]);
  const byUser = Array.from(allUids)
    .map((uid) => {
      const info  = userInfoMap.get(uid)  ?? { name: "Unknown", email: "" };
      const posts  = userPostMap.get(uid)  ?? { total: 0, byStatus: {}, byWorkflow: {} };
      const tokens = userTokenMap.get(uid) ?? { promptTokens: 0, completionTokens: 0, costUsd: 0, imagesGenerated: 0 };
      return { userId: uid, name: info.name, email: info.email, totalPosts: posts.total, byStatus: posts.byStatus, byWorkflow: posts.byWorkflow, ...tokens };
    })
    .sort((a, b) => b.totalPosts - a.totalPosts);

  // Global overview ────────────────────────────────────────────────────────────
  const facets = (postFacet[0] ?? { byStatus: [], byWorkflow: [] }) as { byStatus: AggDoc[]; byWorkflow: AggDoc[] };
  const statusTotals = Object.fromEntries(facets.byStatus.map((s) => [s._id as string, Number(s.count)]));
  const totalPosts = Object.values(statusTotals).reduce((a, b) => a + b, 0);

  const ms = modelStats as AggDoc[];
  const overview = {
    totalPosts,
    publishedPosts:     statusTotals["published"]      ?? 0,
    failedPosts:        statusTotals["failed"]         ?? 0,
    pendingReviewPosts: statusTotals["pending_review"] ?? 0,
    cancelledPosts:     statusTotals["cancelled"]      ?? 0,
    rejectedPosts:      statusTotals["rejected"]       ?? 0,
    totalPromptTokens:     ms.reduce((a, m) => a + Number(m.promptTokens),     0),
    totalCompletionTokens: ms.reduce((a, m) => a + Number(m.completionTokens), 0),
    totalCostUsd:          ms.reduce((a, m) => a + Number(m.costUsd),          0),
    totalImagesGenerated:  ms.reduce((a, m) => a + Number(m.imagesGenerated),  0),
  };

  return ok(reply, {
    range,
    overview,
    byStatus:   facets.byStatus.map((s)   => ({ status:   s._id as string, count: Number(s.count) })),
    byWorkflow: facets.byWorkflow.map((s) => ({ workflow: s._id as string, count: Number(s.count) })),
    byModel: ms.map((m) => ({
      provider:         ((m._id as AggDoc).provider  as string) ?? "unknown",
      model:            ((m._id as AggDoc).model     as string) ?? "unknown",
      promptTokens:     Number(m.promptTokens),
      completionTokens: Number(m.completionTokens),
      costUsd:          Number(m.costUsd),
      imagesGenerated:  Number(m.imagesGenerated),
      requests:         Number(m.requests),
    })),
    byUser,
  });
}

export async function updateNodeConfig(req: FastifyRequest, reply: FastifyReply) {
  const { assignments } = req.body as {
    assignments: Partial<Record<"planner" | "caption" | "generation" | "enhancement", string | null>>;
  };

  const doc = await NodeConfigModel.findOneAndUpdate(
    { singletonKey: "global" },
    { $set: { assignments } },
    { upsert: true, new: true },
  )
    .populate("assignments.planner", "label provider")
    .populate("assignments.caption", "label provider")
    .populate("assignments.generation", "label provider")
    .populate("assignments.enhancement", "label provider");

  const toRef = (v: unknown) => {
    if (!v) return null;
    const o = v as { _id: Types.ObjectId; label: string; provider: string };
    return { id: o._id.toHexString(), label: o.label, provider: o.provider };
  };

  const a = doc?.assignments ?? {};
  return ok(reply, {
    assignments: {
      planner:     toRef((a as Record<string, unknown>).planner),
      caption:     toRef((a as Record<string, unknown>).caption),
      generation:  toRef((a as Record<string, unknown>).generation),
      enhancement: toRef((a as Record<string, unknown>).enhancement),
    },
  });
}

// ── API keys (cross-workspace oversight) ────────────────────────────────────────
//
// Key creation/listing/revocation for a user's OWN workspace is self-service —
// see workspace.controller.ts, mounted on the regular authenticated /v1 group.
// These two are admin/root only: audit every workspace's keys, and revoke one
// that isn't yours (e.g. a compromised or misbehaving integration).

export async function listAllApiKeys(req: FastifyRequest, reply: FastifyReply) {
  const wsIds = await visibleWorkspaceIds(req);
  return ok(reply, await apiKeyService.listApiKeysForWorkspaces(wsIds));
}

export async function revokeApiKeyAdmin(req: FastifyRequest, reply: FastifyReply) {
  const { keyId } = req.params as { keyId: string };
  const wsIds = await visibleWorkspaceIds(req);
  return ok(reply, await apiKeyService.revokeApiKeyInWorkspaces(keyId, wsIds, req.auth!.userId!));
}

// ── Database explorer ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DB_COLLECTIONS: ReadonlyArray<{ name: string; model: Model<any> }> = [
  { name: "users",       model: UserModel       },
  { name: "workspaces",  model: WorkspaceModel  },
  { name: "posts",       model: PostModel       },
  { name: "assets",      model: AssetModel      },
  { name: "jobs",        model: JobModel        },
  { name: "agentlogs",   model: AgentLogModel   },
  { name: "llmconfigs",  model: LlmConfigModel  },
  { name: "nodeconfigs", model: NodeConfigModel },
];

export async function listCollections(_req: FastifyRequest, reply: FastifyReply) {
  const counts = await Promise.all(DB_COLLECTIONS.map((c) => c.model.countDocuments()));
  return ok(reply, DB_COLLECTIONS.map((c, i) => ({ name: c.name, count: counts[i] })));
}

export async function listCollectionDocs(req: FastifyRequest, reply: FastifyReply) {
  const { collection } = req.params as { collection: string };
  const { page = 1, pageSize = 20 } = req.query as { page?: number; pageSize?: number };

  const entry = DB_COLLECTIONS.find((c) => c.name === collection);
  if (!entry) throw new NotFoundError("Collection");

  const safeSize = Math.min(Number(pageSize), 50);
  const safePage = Math.max(Number(page), 1);

  const [rawDocs, total] = await Promise.all([
    entry.model.find().sort({ createdAt: -1 }).skip((safePage - 1) * safeSize).limit(safeSize).lean(),
    entry.model.countDocuments(),
  ]);

  const docs = (rawDocs as Record<string, unknown>[]).map((doc) => redactDoc(collection, doc));

  return ok(reply, { items: docs, total, page: safePage, pageSize: safeSize });
}

const REDACTED = "[redacted]";

/** Blanks a field only when it is actually present, so redaction never invents keys. */
function blank(d: Record<string, unknown>, key: string) {
  if (d[key] !== undefined) d[key] = REDACTED;
}

/** Strips one field from every element of an embedded array. */
function blankInArray(d: Record<string, unknown>, arrayKey: string, field: string) {
  if (!Array.isArray(d[arrayKey])) return;
  d[arrayKey] = (d[arrayKey] as unknown[]).map((el) => {
    const copy = { ...(el as Record<string, unknown>) };
    delete copy[field];
    return copy;
  });
}

/**
 * Field-level redaction for the raw document browser.
 *
 * This endpoint is platform-only, but "the operator can read everything" is not
 * a reason to hand over customer content and credential material in bulk. These
 * fields have no legitimate debugging use from a document dump: prompts and
 * model output are customer IP, and the hashes/token pointers are live
 * credential material.
 */
function redactDoc(collection: string, doc: Record<string, unknown>): Record<string, unknown> {
  const d = { ...doc };
  switch (collection) {
    case "users":
      delete d["passwordHash"];
      break;
    case "llmconfigs":
      if (typeof d["apiKey"] === "string") d["apiKey"] = maskApiKey(d["apiKey"]);
      break;
    case "workspaces":
      // argon2 hashes of live API keys, and pointers to stored social tokens
      blankInArray(d, "apiKeys", "hashedKey");
      blankInArray(d, "socialAccounts", "accessTokenRef");
      break;
    case "agentlogs":
      // raw prompts sent to providers and raw model output
      blank(d, "input");
      blank(d, "output");
      break;
    case "posts":
      // the brief / prompt / instructions the customer wrote
      blank(d, "input");
      break;
  }
  return d;
}
