import type { FastifyReply, FastifyRequest } from "fastify";
import { Types } from "mongoose";
import { createApiKeySchema } from "@visora/shared";
import { env } from "../../config/env.js";
import { UserModel } from "../../db/models/index.js";
import * as apiKeyService from "../../modules/workspace/api-key.service.js";
import * as tenantService from "../../modules/workspace/tenant.service.js";
import { BadRequestError, ForbiddenError } from "../../lib/errors.js";
import { workspaceBelongsToOrg } from "../middleware/auth.js";
import { created, ok } from "../reply.js";

export async function createApiKey(req: FastifyRequest, reply: FastifyReply) {
  const input = createApiKeySchema.parse(req.body);
  const result = await apiKeyService.createApiKey(req.auth!.workspaceId, input);
  return created(reply, result);
}

export async function listApiKeys(req: FastifyRequest, reply: FastifyReply) {
  const keys = await apiKeyService.listApiKeys(req.auth!.workspaceId);
  return ok(reply, keys);
}

export async function revokeApiKey(req: FastifyRequest, reply: FastifyReply) {
  const { keyId } = req.params as { keyId: string };
  const key = await apiKeyService.revokeApiKey(req.auth!.workspaceId, keyId, req.auth!.userId!);
  return ok(reply, key);
}

// ── Workspaces (brands/products within the tenant) ────────────────────────────

/** The caller's membership roles, keyed by workspace id. */
async function membershipMap(userId: string): Promise<Map<string, string>> {
  const user = await UserModel.findById(new Types.ObjectId(userId)).select("workspaces").lean();
  return new Map(
    (user?.workspaces ?? []).map((w) => [w.workspaceId.toString(), w.role as string]),
  );
}

/**
 * Workspaces in the caller's organization. The tenant root sees all of them;
 * anyone else sees only the ones they hold a membership on.
 */
export async function listWorkspaces(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.auth!;
  const mine = await membershipMap(auth.userId!);
  const all = await tenantService.listWorkspacesForOrg(auth.organizationId, mine);

  const visible =
    auth.platformRole === "root" || auth.orgRole === "owner"
      ? all
      : all.filter((w) => mine.has(w.id));

  return ok(reply, visible);
}

/** Adds a brand/product workspace. Tenant root only (enforced on the route). */
export async function createWorkspace(req: FastifyRequest, reply: FastifyReply) {
  const { name } = req.body as { name: string };
  const auth = req.auth!;
  const ws = await tenantService.createWorkspace({
    organizationId: auth.organizationId,
    name,
    creatorUserId: auth.userId!,
  });
  return created(reply, ws);
}

export async function renameWorkspace(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const { name } = req.body as { name: string };
  return ok(reply, await tenantService.renameWorkspace(id, req.auth!.organizationId, name));
}

export async function archiveWorkspace(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  return ok(reply, await tenantService.archiveWorkspace(id, req.auth!.organizationId));
}

/**
 * Switches the active workspace for subsequent requests by re-issuing an access
 * token bound to it. `workspaceId` is a signed JWT claim, so it cannot be
 * changed client-side — and the same access rule is re-checked here, so
 * switching can never widen what the caller can reach.
 */
export async function switchWorkspace(req: FastifyRequest, reply: FastifyReply) {
  const { workspaceId } = req.body as { workspaceId: string };
  const auth = req.auth!;

  if (!Types.ObjectId.isValid(workspaceId)) {
    throw new BadRequestError("A valid workspaceId is required");
  }
  if (auth.via === "api_key") {
    throw new ForbiddenError("API keys are bound to a single workspace");
  }

  // Re-read the membership for the TARGET workspace — auth.workspaceRole
  // describes the current one and would otherwise wrongly authorize the switch.
  const mine = await membershipMap(auth.userId!);
  const targetRole = mine.get(workspaceId) ?? null;

  const allowed =
    auth.platformRole === "root" ||
    targetRole !== null ||
    (auth.orgRole === "owner" && (await workspaceBelongsToOrg(workspaceId, auth.organizationId)));
  if (!allowed) throw new ForbiddenError("Not a member of that workspace");

  const accessToken = req.server.jwt.sign(
    { sub: auth.userId, orgId: auth.organizationId, workspaceId },
    { expiresIn: env.JWT_ACCESS_TTL },
  );

  await UserModel.updateOne(
    { _id: new Types.ObjectId(auth.userId) },
    { $set: { defaultWorkspaceId: new Types.ObjectId(workspaceId) } },
  );

  return ok(reply, { accessToken, workspaceId, expiresIn: 900 });
}
