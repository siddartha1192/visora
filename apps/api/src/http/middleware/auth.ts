import argon2 from "argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { OrgRole, PlatformRole, WorkspaceRole } from "@visora/shared";
import { Types } from "mongoose";
import { UserModel, WorkspaceModel } from "../../db/models/index.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";

/**
 * Identity attached to every authenticated request, resolved once here so no
 * handler has to re-derive it — the previous per-handler approach is what let
 * the log endpoints ship without a tenant filter.
 */
export interface AuthContext {
  userId?: string;
  userName?: string;
  userEmail?: string;

  /** The tenant. Always set for JWT callers; derived from the key's workspace for API keys. */
  organizationId: string;
  /** null for platform staff and for API-key callers (a key has no user). */
  orgRole: OrgRole | null;
  /** Non-null only for SaaS operator staff. */
  platformRole: PlatformRole | null;

  /** The workspace this request acts on. */
  workspaceId: string;
  /** The caller's role on `workspaceId`, when it comes from an explicit membership. */
  workspaceRole: WorkspaceRole | null;

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
 * Both resolve to an AuthContext carrying the active org + workspace, so
 * downstream controllers are identical regardless of entrypoint.
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
      orgId?: string;
      workspaceId: string;
    }>();
    req.auth = {
      userId: payload.sub,
      // Provisional: `assertMembership` re-reads both from the database rather
      // than trusting the token, so a stale or tampered claim cannot widen access.
      organizationId: payload.orgId ?? "",
      orgRole: null,
      platformRole: null,
      workspaceId: payload.workspaceId,
      workspaceRole: null,
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
  if (record.expiresAt && record.expiresAt < new Date()) {
    throw new UnauthorizedError("API key expired");
  }
  const valid = await argon2.verify(record.hashedKey, secret);
  if (!valid) throw new UnauthorizedError("Invalid API key");

  record.lastUsedAt = new Date();
  await workspace.save();

  return {
    // A key belongs to exactly one workspace, which belongs to exactly one org.
    organizationId: workspace.organizationId?.toString() ?? "",
    orgRole: null,
    platformRole: null,
    workspaceId: workspace._id.toHexString(),
    workspaceRole: null,
    via: "api_key",
    scopes: record.scopes,
  };
}

/**
 * Resolves the caller's real tenancy from the database and authorizes them for
 * the workspace they're targeting. This is the single choke point for the
 * access rule:
 *
 *   platform staff        → any workspace
 *   org owner (tenant root) → any workspace IN THEIR OWN org
 *   everyone else         → only workspaces they hold a membership on
 *
 * A workspace admin therefore never crosses the workspace boundary, even
 * within their own organization.
 */
export async function assertMembership(req: FastifyRequest) {
  const auth = req.auth;
  if (!auth) throw new UnauthorizedError();

  if (auth.via === "api_key") {
    // The key itself is workspace-scoped and unforgeable; org came from the
    // workspace record, so there is nothing further to verify.
    if (!auth.organizationId) {
      throw new ForbiddenError("API key's workspace has no organization");
    }
    return;
  }

  const user = await UserModel.findById(new Types.ObjectId(auth.userId));
  if (!user) throw new UnauthorizedError();
  if (user.status !== "active") throw new ForbiddenError("Account is not active");

  // Trust the database, never the token, for anything authorization depends on.
  auth.userName = user.name;
  auth.userEmail = user.email;
  auth.organizationId = user.organizationId?.toString() ?? "";
  auth.orgRole = (user.orgRole ?? null) as OrgRole | null;
  auth.platformRole = (user.platformRole ?? null) as PlatformRole | null;

  const membership = user.workspaces.find(
    (w) => w.workspaceId.toString() === auth.workspaceId,
  );
  auth.workspaceRole = (membership?.role ?? null) as WorkspaceRole | null;

  if (await canAccessWorkspace(auth, auth.workspaceId)) return;
  throw new ForbiddenError("Not a member of this workspace");
}

/**
 * The authorization predicate. Everything workspace-scoped resolves through
 * this so the rule lives in exactly one place.
 */
export async function canAccessWorkspace(
  auth: AuthContext,
  workspaceId: string,
): Promise<boolean> {
  if (auth.platformRole === "root") return true;

  // Explicit membership — the common path for workspace admins/editors/viewers.
  if (auth.workspaceRole && workspaceId === auth.workspaceId) return true;

  // Tenant root reaches every workspace in their own organization, and only theirs.
  if (auth.orgRole === "owner" && auth.organizationId) {
    return workspaceBelongsToOrg(workspaceId, auth.organizationId);
  }

  return false;
}

/** True when `workspaceId` is inside `organizationId`. */
export async function workspaceBelongsToOrg(
  workspaceId: string,
  organizationId: string,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(workspaceId) || !Types.ObjectId.isValid(organizationId)) {
    return false;
  }
  return Boolean(
    await WorkspaceModel.exists({
      _id: new Types.ObjectId(workspaceId),
      organizationId: new Types.ObjectId(organizationId),
    }),
  );
}

/** Every workspace id in an organization — the scoping key for org-wide queries. */
export async function workspaceIdsForOrg(organizationId: string): Promise<Types.ObjectId[]> {
  if (!Types.ObjectId.isValid(organizationId)) return [];
  const rows = await WorkspaceModel.find({
    organizationId: new Types.ObjectId(organizationId),
  })
    .select("_id")
    .lean();
  return rows.map((r) => r._id as Types.ObjectId);
}
