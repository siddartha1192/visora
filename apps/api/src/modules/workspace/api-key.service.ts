import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { Types } from "mongoose";
import type { AdminApiKeyDTO, ApiKeyDTO, CreateApiKeyInput, CreatedApiKeyDTO } from "@visora/shared";
import { UserModel, WorkspaceModel } from "../../db/models/index.js";
import { NotFoundError } from "../../lib/errors.js";

type ApiKeySubdoc = {
  keyId: string;
  label: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revoked: boolean;
  revokedAt: Date | null;
  revokedBy: Types.ObjectId | null;
  createdAt: Date;
};

function toDTO(k: ApiKeySubdoc, revokedByLabel: string | null): ApiKeyDTO {
  return {
    keyId: k.keyId,
    label: k.label,
    scopes: k.scopes,
    createdAt: k.createdAt.toISOString(),
    expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    revoked: k.revoked,
    revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
    revokedBy: revokedByLabel,
  };
}

/** Batch-resolves user ids to `{ name, email }` in one query, deduped. */
async function resolveUsers(
  ids: Array<Types.ObjectId | null | undefined>,
): Promise<Map<string, { name: string; email: string }>> {
  const unique = [...new Set(ids.filter((id): id is Types.ObjectId => Boolean(id)).map((id) => id.toHexString()))];
  if (unique.length === 0) return new Map();
  const users = await UserModel.find({ _id: { $in: unique } }).select("email name").lean();
  return new Map(users.map((u) => [u._id.toHexString(), { name: u.name, email: u.email }]));
}

function revokedByLabel(id: Types.ObjectId | null, users: Map<string, { name: string; email: string }>): string | null {
  if (!id) return null;
  const u = users.get(id.toHexString());
  return u ? `${u.name} (${u.email})` : null;
}

/**
 * Mints a new `vsk_<keyId>.<secret>` workspace API key. The secret is
 * argon2-hashed before storage and returned to the caller exactly once —
 * it cannot be recovered afterwards, only rotated (revoke + create new).
 */
export async function createApiKey(
  workspaceId: string,
  input: CreateApiKeyInput,
): Promise<CreatedApiKeyDTO> {
  const workspace = await WorkspaceModel.findById(workspaceId);
  if (!workspace) throw new NotFoundError("Workspace");

  const keyId = randomBytes(6).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const hashedKey = await argon2.hash(secret);
  const expiresAt =
    input.expiresInDays !== null
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  workspace.apiKeys.push({
    keyId,
    hashedKey,
    label: input.label,
    expiresAt,
    revoked: false,
  });
  await workspace.save();

  const created = workspace.apiKeys[workspace.apiKeys.length - 1] as unknown as ApiKeySubdoc;
  return { apiKey: toDTO(created, null), secret: `vsk_${keyId}.${secret}` };
}

export async function listApiKeys(workspaceId: string): Promise<ApiKeyDTO[]> {
  const workspace = await WorkspaceModel.findById(workspaceId);
  if (!workspace) throw new NotFoundError("Workspace");

  const keys = workspace.apiKeys as unknown as ApiKeySubdoc[];
  const users = await resolveUsers(keys.map((k) => k.revokedBy));
  return keys.map((k) => toDTO(k, revokedByLabel(k.revokedBy, users)));
}

export async function revokeApiKey(
  workspaceId: string,
  keyId: string,
  revokedByUserId: string,
): Promise<ApiKeyDTO> {
  const workspace = await WorkspaceModel.findById(workspaceId);
  if (!workspace) throw new NotFoundError("Workspace");

  const record = workspace.apiKeys.find((k) => k.keyId === keyId);
  if (!record) throw new NotFoundError("API key");

  const revokerId = new Types.ObjectId(revokedByUserId);
  record.revoked = true;
  record.revokedAt = new Date();
  record.revokedBy = revokerId;
  await workspace.save();

  const users = await resolveUsers([revokerId]);
  return toDTO(record as unknown as ApiKeySubdoc, revokedByLabel(revokerId, users));
}

// ── Oversight — spans workspaces, but only ones the caller may reach ──────────

/**
 * API keys for an explicit set of workspaces, for the oversight screen.
 *
 * `workspaceIds` is the caller's reachable set: their whole organization for a
 * tenant root, only their own workspaces for a workspace admin. `null` means
 * unrestricted and is passed ONLY for platform staff — every other caller must
 * supply a concrete list, so there is no way to accidentally see every tenant.
 */
export async function listApiKeysForWorkspaces(
  workspaceIds: Types.ObjectId[] | null,
): Promise<AdminApiKeyDTO[]> {
  const scope = workspaceIds !== null ? { _id: { $in: workspaceIds } } : {};
  const workspaces = await WorkspaceModel.find({ ...scope, "apiKeys.0": { $exists: true } })
    .select("name ownerId apiKeys")
    .lean();
  if (workspaces.length === 0) return [];

  const allKeys = workspaces.flatMap((w) => w.apiKeys as unknown as ApiKeySubdoc[]);
  const users = await resolveUsers([
    ...workspaces.map((w) => w.ownerId),
    ...allKeys.map((k) => k.revokedBy),
  ]);

  return workspaces.flatMap((w) => {
    const owner = users.get(w.ownerId?.toHexString() ?? "") ?? { email: "—", name: "—" };
    return (w.apiKeys as unknown as ApiKeySubdoc[]).map((k) => ({
      ...toDTO(k, revokedByLabel(k.revokedBy, users)),
      workspaceId: (w._id as unknown as { toHexString(): string }).toHexString(),
      workspaceName: w.name,
      ownerEmail: owner.email,
      ownerName: owner.name,
    }));
  });
}

/**
 * Revokes a key in any workspace the caller may reach. Locating the key by id
 * alone would let one tenant kill another tenant's integration, so the
 * workspace scope is part of the lookup itself, and a key outside it reads as
 * "not found" rather than "forbidden".
 */
export async function revokeApiKeyInWorkspaces(
  keyId: string,
  workspaceIds: Types.ObjectId[] | null,
  revokedByUserId: string,
): Promise<AdminApiKeyDTO> {
  const scope = workspaceIds !== null ? { _id: { $in: workspaceIds } } : {};
  const workspace = await WorkspaceModel.findOne({ ...scope, "apiKeys.keyId": keyId });
  if (!workspace) throw new NotFoundError("API key");

  const record = workspace.apiKeys.find((k) => k.keyId === keyId);
  if (!record) throw new NotFoundError("API key");

  const revokerId = new Types.ObjectId(revokedByUserId);
  record.revoked = true;
  record.revokedAt = new Date();
  record.revokedBy = revokerId;
  await workspace.save();

  const users = await resolveUsers([workspace.ownerId, revokerId]);
  const owner = users.get(workspace.ownerId?.toHexString() ?? "") ?? { email: "—", name: "—" };
  return {
    ...toDTO(record as unknown as ApiKeySubdoc, revokedByLabel(revokerId, users)),
    workspaceId: workspace._id.toHexString(),
    workspaceName: workspace.name,
    ownerEmail: owner.email,
    ownerName: owner.name,
  };
}
