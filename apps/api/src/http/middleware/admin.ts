import type { FastifyRequest } from "fastify";
import { Types } from "mongoose";
import { UserModel } from "../../db/models/index.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";

/**
 * Guards for the three authorization tiers.
 *
 * All of these MUST be `async`. Fastify's hook runner always passes `next` as
 * the third argument and only continues the chain when the hook returns a
 * thenable — a sync hook returning `undefined` never calls `next` and the
 * request hangs on the *success* path (the throw path still works, which makes
 * the bug easy to miss).
 */

/** Loads the caller's tenancy onto req.auth. Safe to run without assertMembership. */
async function loadIdentity(req: FastifyRequest) {
  if (!req.auth) throw new UnauthorizedError();
  // API keys authenticate a workspace, not a person — they can never satisfy a
  // user-role guard, so reject rather than silently treating them as a member.
  if (req.auth.via === "api_key") {
    throw new ForbiddenError("This endpoint requires a user session, not an API key");
  }
  if (!req.auth.userId) throw new UnauthorizedError();

  // assertMembership already populates these on workspace-scoped routes; admin
  // routes don't run it, so resolve here when absent.
  if (req.auth.orgRole === null && req.auth.platformRole === null) {
    const user = await UserModel.findById(new Types.ObjectId(req.auth.userId));
    if (!user) throw new UnauthorizedError();
    if (user.status !== "active") throw new ForbiddenError("Account is not active");
    req.auth.userName = user.name;
    req.auth.userEmail = user.email;
    req.auth.organizationId = user.organizationId?.toString() ?? "";
    req.auth.orgRole = (user.orgRole ?? null) as typeof req.auth.orgRole;
    req.auth.platformRole = (user.platformRole ?? null) as typeof req.auth.platformRole;
  }
  return req.auth;
}

/**
 * SaaS operator staff only. Gates shared infrastructure that is not owned by
 * any customer: LLM provider credentials, the global node→model routing
 * singleton, the raw document browser, and tenant provisioning.
 */
export async function requirePlatform(req: FastifyRequest) {
  const auth = await loadIdentity(req);
  if (auth.platformRole !== "root") {
    throw new ForbiddenError("Platform access required");
  }
}

/**
 * The tenant's root user. Gates org-wide actions — creating workspaces,
 * provisioning users, viewing org-wide usage. Platform staff also pass, so
 * they can support a customer.
 *
 * A workspace admin does NOT pass: that is what keeps one brand's admin out of
 * another brand's data.
 */
export async function requireOrgOwner(req: FastifyRequest) {
  const auth = await loadIdentity(req);
  if (auth.platformRole === "root") return;
  if (auth.orgRole !== "owner") {
    throw new ForbiddenError("Organization owner access required");
  }
  if (!auth.organizationId) {
    throw new ForbiddenError("Account has no organization");
  }
}

/**
 * Any authenticated member of an organization — the entry gate for the
 * admin-console surface, whose handlers are individually scoped to
 * `req.auth.organizationId` (and further to the caller's workspaces where the
 * caller is not the tenant root).
 */
export async function requireOrgMember(req: FastifyRequest) {
  const auth = await loadIdentity(req);
  if (auth.platformRole === "root") return;
  if (!auth.organizationId) {
    throw new ForbiddenError("Account has no organization");
  }
}
