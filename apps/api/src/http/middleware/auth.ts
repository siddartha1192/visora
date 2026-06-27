import argon2 from "argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Types } from "mongoose";
import { UserModel, WorkspaceModel } from "../../db/models/index.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";

/** Identity attached to every authenticated request. */
export interface AuthContext {
  userId?: string;
  workspaceId: string;
  via: "jwt" | "api_key";
  scopes: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/**
 * Dual auth: a Bearer JWT (web users) OR an `x-api-key` (external systems).
 * Both resolve to an AuthContext carrying the active workspace, so downstream
 * controllers are identical regardless of entrypoint — this is what makes the
 * "hybrid delivery" promise hold with one code path.
 */
export async function authenticate(req: FastifyRequest, _reply: FastifyReply) {
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.length > 0) {
    req.auth = await resolveApiKey(apiKey);
    return;
  }

  try {
    const payload = await req.jwtVerify<{
      sub: string;
      workspaceId: string;
    }>();
    req.auth = {
      userId: payload.sub,
      workspaceId: payload.workspaceId,
      via: "jwt",
      scopes: ["*"],
    };
  } catch {
    throw new UnauthorizedError("Missing or invalid credentials");
  }
}

async function resolveApiKey(raw: string): Promise<AuthContext> {
  // Format: "vsk_<keyId>.<secret>" — keyId locates the record, secret is verified.
  const [prefix, secret] = raw.split(".");
  const keyId = prefix?.replace(/^vsk_/, "");
  if (!keyId || !secret) throw new UnauthorizedError("Malformed API key");

  const workspace = await WorkspaceModel.findOne({ "apiKeys.keyId": keyId });
  const record = workspace?.apiKeys.find((k) => k.keyId === keyId);
  if (!workspace || !record || record.revoked) {
    throw new UnauthorizedError("Invalid API key");
  }
  const valid = await argon2.verify(record.hashedKey, secret);
  if (!valid) throw new UnauthorizedError("Invalid API key");

  record.lastUsedAt = new Date();
  await workspace.save();

  return {
    workspaceId: workspace._id.toHexString(),
    via: "api_key",
    scopes: record.scopes,
  };
}

/** Ensures a JWT user actually belongs to the workspace they target. */
export async function assertMembership(req: FastifyRequest) {
  const auth = req.auth;
  if (!auth) throw new UnauthorizedError();
  if (auth.via === "api_key") return; // key is already workspace-scoped

  const user = await UserModel.findById(new Types.ObjectId(auth.userId));
  const isMember = user?.workspaces.some(
    (w) => w.workspaceId.toString() === auth.workspaceId,
  );
  if (!isMember) throw new ForbiddenError("Not a member of this workspace");
}
