import argon2 from "argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Types } from "mongoose";
import {
  LlmConfigModel,
  NodeConfigModel,
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
