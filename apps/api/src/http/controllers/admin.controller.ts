import argon2 from "argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Model } from "mongoose";
import { Types } from "mongoose";
import {
  AgentLogModel,
  AssetModel,
  JobModel,
  LlmConfigModel,
  NodeConfigModel,
  PostModel,
  UserModel,
  WorkspaceModel,
} from "../../db/models/index.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
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
    isAdmin: u.isAdmin ?? false,
    workspaceCount: u.workspaces.length,
    lastLoginAt: u.lastLoginAt ?? null,
    createdAt: (u as unknown as { createdAt: Date }).createdAt,
  };
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
  return ok(reply, {
    id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin ?? false,
  });
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function listUsers(_req: FastifyRequest, reply: FastifyReply) {
  const users = await UserModel.find().sort({ createdAt: -1 });
  return ok(reply, users.map(formatUser));
}

export async function createUser(req: FastifyRequest, reply: FastifyReply) {
  const { name, email, password, isAdmin = false } = req.body as {
    name: string;
    email: string;
    password: string;
    isAdmin?: boolean;
  };

  const existing = await UserModel.findOne({ email: email.toLowerCase() });
  if (existing) throw new ConflictError("Email already registered");

  const passwordHash = await argon2.hash(password);
  const user = await UserModel.create({
    name,
    email: email.toLowerCase(),
    passwordHash,
    isAdmin,
    status: "active",
  });

  const workspace = await WorkspaceModel.create({
    name: `${name}'s Workspace`,
    ownerId: user._id,
  });
  user.workspaces.push({ workspaceId: workspace._id, role: "owner" });
  user.defaultWorkspaceId = workspace._id;
  await user.save();

  return created(reply, formatUser(user));
}

export async function updateUser(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const patch = req.body as Partial<{ status: string; isAdmin: boolean }>;

  const user = await UserModel.findByIdAndUpdate(
    new Types.ObjectId(id),
    { $set: patch },
    { new: true },
  );
  if (!user) throw new NotFoundError("User");
  return ok(reply, formatUser(user));
}

export async function deleteUser(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  // Prevent self-deletion
  if (id === req.auth!.userId) throw new BadRequestError("Cannot delete your own account");
  const user = await UserModel.findByIdAndDelete(new Types.ObjectId(id));
  if (!user) throw new NotFoundError("User");
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
  const wsIds = [...new Set(posts.map((p) => p.workspaceId.toString()))];
  const wsObjectIds = wsIds.map((id) => new Types.ObjectId(id));
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
      platforms: (p.targets ?? []).map((t: { platform: string }) => t.platform),
      primaryAssetId: p.primaryAssetId?.toString(),
      lastError: p.lastError ?? undefined,
      createdAt: (p as unknown as { createdAt: Date }).createdAt.toISOString(),
    };
  });

  return ok(reply, { items, total, page: safePage, pageSize: safeSize });
}

export async function deletePost(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const post = await PostModel.findByIdAndDelete(new Types.ObjectId(id));
  if (!post) throw new NotFoundError("Post");
  return ok(reply, { deleted: id });
}

// ── LLM Configs ───────────────────────────────────────────────────────────────

export async function listLlmConfigs(_req: FastifyRequest, reply: FastifyReply) {
  const configs = await LlmConfigModel.find().sort({ createdAt: -1 });
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
  const cfg = await LlmConfigModel.create(body);
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
  const cfg = await LlmConfigModel.findByIdAndUpdate(
    new Types.ObjectId(id),
    { $set: patch },
    { new: true },
  );
  if (!cfg) throw new NotFoundError("LLM config");
  return ok(reply, formatLlmConfig(cfg));
}

export async function deleteLlmConfig(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const cfg = await LlmConfigModel.findByIdAndDelete(new Types.ObjectId(id));
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

  const postFilter = dateFrom ? { createdAt: { $gte: dateFrom } } : {};
  const logFilter  = dateFrom ? { createdAt: { $gte: dateFrom } } : {};

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
    UserModel.find({}, { _id: 1, name: 1, email: 1 }).lean(),
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

  const docs = (rawDocs as Record<string, unknown>[]).map((doc) => {
    const d = { ...doc };
    if (collection === "users") delete d["passwordHash"];
    if (collection === "llmconfigs" && typeof d["apiKey"] === "string") {
      d["apiKey"] = maskApiKey(d["apiKey"] as string);
    }
    return d;
  });

  return ok(reply, { items: docs, total, page: safePage, pageSize: safeSize });
}
