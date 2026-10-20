import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { registerRoutes } from "../http/routes/index.js";

/**
 * Enumerates every route Fastify actually registers (via the `onRoute` hook,
 * not a hand-maintained list) and asserts each one is on an explicit
 * TENANT_SCOPED or PLATFORM_GLOBAL allowlist below.
 *
 * This is the check the design doc calls "the part that actually prevents the
 * fourteenth leak from being written next month": a route that is neither
 * classified nor covered by an authorization preHandler fails the build,
 * rather than silently shipping unscoped the way the original `/v1/admin/*`
 * surface and `log.controller.ts` did.
 *
 * Classification is read off the actual code, not guessed:
 *  - TENANT_SCOPED  — reachable only within the caller's own organization/
 *    workspace. Either runs `assertMembership` (the `/v1` group), or runs
 *    `requireOrgMember`/`requireOrgOwner` and is scoped inside its handler
 *    to `req.auth.organizationId` (the `/v1/admin` group, minus the
 *    platform-only routes carved out of it).
 *  - PLATFORM_GLOBAL — deliberately crosses every organization. Gated by
 *    `requirePlatform` (`platformRole === 'root'` only): the `/v1/platform`
 *    group, and the LLM-config/node-config/database-browser routes nested
 *    inside `/v1/admin`.
 *  - PUBLIC — no authentication at all. Kept to the smallest possible set
 *    (health check, login, refresh) — see the explicit list below.
 */

type RouteKey = `${string} ${string}`;

const PUBLIC: ReadonlySet<RouteKey> = new Set<RouteKey>([
  "GET /health",
  "POST /v1/auth/login",
  "POST /v1/auth/refresh",

  // Signup — payment-gated self-service account creation. No org/workspace
  // context exists yet for the caller until the mock payment clears and
  // provisionTenant runs inside the handler.
  "POST /v1/auth/signup",

  // Invite preview/accept — the token itself is the credential, same trust
  // model as a password-reset link. No org/workspace context exists yet for
  // the caller until the token is validated inside the handler.
  "GET /v1/invites/:token",
  "POST /v1/invites/:token/accept",
]);

const TENANT_SCOPED: ReadonlySet<RouteKey> = new Set<RouteKey>([
  // Identity
  "GET /v1/auth/me",

  // Self-service API keys — scoped to req.auth.workspaceId
  "POST /v1/api-keys",
  "GET /v1/api-keys",
  "DELETE /v1/api-keys/:keyId",

  // Workspaces — scoped to the caller's own organization
  "GET /v1/workspaces",
  "POST /v1/workspaces",
  "PATCH /v1/workspaces/:id",
  "DELETE /v1/workspaces/:id",
  "POST /v1/workspaces/switch",

  // Workspace invites — scoped to workspaces the caller administers, via
  // the same adminableWorkspaceIds predicate admin.createUser uses.
  "POST /v1/workspaces/:id/invites",
  "GET /v1/workspaces/:id/invites",
  "DELETE /v1/invites/:invitationId",

  // BYOK LLM configs — requireOrgOwner, always filtered to req.auth.organizationId.
  // Distinct from the PLATFORM_GLOBAL /v1/admin/llm-configs below.
  "GET /v1/llm-configs",
  "POST /v1/llm-configs",
  "PATCH /v1/llm-configs/:id",
  "DELETE /v1/llm-configs/:id",

  // Posts — scoped to req.auth.workspaceId
  "POST /v1/posts",
  "GET /v1/posts",
  "GET /v1/posts/:id",
  "POST /v1/posts/:id/approve",
  "POST /v1/posts/:id/reject",
  "POST /v1/posts/:id/cancel",
  "POST /v1/posts/:id/retry",

  // Assets — scoped to req.auth.workspaceId
  "POST /v1/assets",
  "GET /v1/assets",
  "GET /v1/assets/:id",

  // Prompt utilities — no cross-tenant data, but still runs in the
  // authenticated + assertMembership group
  "POST /v1/prompts/refine",

  // Logs — scoped to req.auth.workspaceId (the exact endpoints Phase 0 fixed)
  "GET /v1/posts/:id/logs",
  "GET /v1/posts/:id/logs/stream",

  // Admin console — requireOrgMember, then handler-level scoping to the
  // caller's organization (tenant root: whole org; workspace admin: only
  // workspaces they administer)
  "GET /v1/admin/me",
  "GET /v1/admin/analytics",
  "GET /v1/admin/users",
  "POST /v1/admin/users",
  "PATCH /v1/admin/users/:id",
  "DELETE /v1/admin/users/:id",
  "GET /v1/admin/posts",
  "POST /v1/admin/posts/:id/cancel",
  "DELETE /v1/admin/posts/:id",
  "GET /v1/admin/api-keys",
  "DELETE /v1/admin/api-keys/:keyId",
]);

const PLATFORM_GLOBAL: ReadonlySet<RouteKey> = new Set<RouteKey>([
  // Nested inside /v1/admin but individually gated by requirePlatform —
  // shared infrastructure owned by the SaaS operator, not any one customer.
  "GET /v1/admin/llm-configs",
  "POST /v1/admin/llm-configs",
  "PATCH /v1/admin/llm-configs/:id",
  "DELETE /v1/admin/llm-configs/:id",
  "GET /v1/admin/node-config",
  "PUT /v1/admin/node-config",
  "GET /v1/admin/database/collections",
  "GET /v1/admin/database/collections/:collection/docs",

  // The one surface that deliberately crosses organizations end to end.
  "POST /v1/platform/tenants",
  "GET /v1/platform/tenants",
  "PATCH /v1/platform/tenants/:id",
]);

async function collectRegisteredRoutes(): Promise<RouteKey[]> {
  const app = Fastify();
  await app.register(jwt, { secret: "test-secret-for-route-enumeration-only" });

  const found: RouteKey[] = [];
  app.addHook("onRoute", (route) => {
    // HEAD is auto-added by Fastify alongside every GET; not a distinct
    // handler worth classifying separately.
    if (route.method === "HEAD") return;
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const m of methods) {
      if (m === "HEAD") continue;
      found.push(`${m} ${route.url}` as RouteKey);
    }
  });

  await registerRoutes(app);
  await app.ready();
  await app.close();
  return found;
}

describe("tenancy contract", () => {
  it("classifies every registered route as PUBLIC, TENANT_SCOPED, or PLATFORM_GLOBAL", async () => {
    const routes = await collectRegisteredRoutes();
    expect(routes.length).toBeGreaterThan(0);

    const unclassified = routes.filter(
      (r) => !PUBLIC.has(r) && !TENANT_SCOPED.has(r) && !PLATFORM_GLOBAL.has(r),
    );

    expect(
      unclassified,
      `Route(s) registered in http/routes/index.ts but not classified in this ` +
        `test's allowlists. A new route must be explicitly marked PUBLIC, ` +
        `TENANT_SCOPED, or PLATFORM_GLOBAL before it can ship — this is what ` +
        `stops a route from silently going out unscoped.`,
    ).toEqual([]);
  });

  it("has no route listed on more than one allowlist", () => {
    const allLists = [PUBLIC, TENANT_SCOPED, PLATFORM_GLOBAL];
    const seen = new Map<RouteKey, string[]>();
    const names = ["PUBLIC", "TENANT_SCOPED", "PLATFORM_GLOBAL"];
    allLists.forEach((list, i) => {
      for (const route of list) {
        const owners = seen.get(route) ?? [];
        owners.push(names[i]!);
        seen.set(route, owners);
      }
    });
    const conflicts = [...seen.entries()].filter(([, owners]) => owners.length > 1);
    expect(conflicts).toEqual([]);
  });

  it("does not classify any allowlisted route that no longer exists", async () => {
    const routes = new Set(await collectRegisteredRoutes());
    const allClassified = [...PUBLIC, ...TENANT_SCOPED, ...PLATFORM_GLOBAL];
    const stale = allClassified.filter((r) => !routes.has(r));

    expect(
      stale,
      `Route(s) on this test's allowlists that are no longer registered — the ` +
        `test list has drifted from http/routes/index.ts and should be trimmed.`,
    ).toEqual([]);
  });
});
