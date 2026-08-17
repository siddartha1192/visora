import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { Types } from "mongoose";
import {
  buildTestApp,
  seedOrg,
  seedMember,
  addWorkspace,
  seedPlatformRoot,
  authHeader,
  type SeededOrg,
} from "./helpers.js";
import { PostModel } from "../db/models/index.js";

vi.mock("../queue/post-queue.js", () => import("./mock-queue.js"));

/**
 * The three properties the design doc calls the actual definition of this
 * model (Verification #3), none of which the two-org test can cover because
 * it never puts two workspaces inside one organization:
 *
 *  1. A workspace admin on Brand A gets 403/404 on every Brand B resource,
 *     even though both brands share one org — this is the core new
 *     guarantee: "admin" means workspace admin, not org-wide admin.
 *  2. The org's `orgRole: 'owner'` reaches both Brand A and Brand B (and
 *     nothing outside the org).
 *  3. No customer role — owner included — reaches platform-only routes;
 *     only `platformRole: 'root'` does.
 */
describe("role matrix", () => {
  let app: FastifyInstance;
  let org: SeededOrg; // org.workspaceId === Brand A
  let brandB: string;
  let brandAAdmin: { userId: string; token: string };

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    org = await seedOrg(app, { orgName: "Multi-Brand Co", ownerEmail: "owner@multibrand.test", workspaceName: "Brand A" });
    brandB = await addWorkspace(org.orgId, "Brand B", org.ownerId);
    brandAAdmin = await seedMember(app, {
      orgId: org.orgId,
      workspaceId: org.workspaceId,
      email: "brand-a-admin@multibrand.test",
      workspaceRole: "admin",
    });
  });

  // ── Property 1: workspace admin never crosses workspaces, even in-org ──────

  it("Brand A's admin is refused membership when acting as Brand B (assertMembership rejects the workspace claim)", async () => {
    // A workspace-scoped route requires a token whose `workspaceId` claim
    // matches a workspace the caller can reach. Brand A's admin token is
    // bound to Brand A; using it against Brand B's id at the membership gate
    // itself (not just inside a handler) is the first line of defense.
    const forgedToken = app.jwt.sign(
      { sub: brandAAdmin.userId, orgId: org.orgId, workspaceId: brandB },
      { expiresIn: "15m" },
    );
    const res = await app.inject({
      method: "GET",
      url: "/v1/posts",
      headers: authHeader(forgedToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("Brand A's admin cannot read, list, or mutate Brand B's posts through the admin console", async () => {
    const postBrandB = await PostModel.create({
      workspaceId: new Types.ObjectId(brandB),
      authorId: new Types.ObjectId(org.ownerId),
      workflow: "passthrough",
      status: "pending_review",
      targets: [],
    });

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/admin/posts?pageSize=50",
      headers: authHeader(brandAAdmin.token),
    });
    expect(listRes.statusCode).toBe(200);
    const ids: string[] = listRes.json().data.items.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(postBrandB._id.toHexString());

    const cancelRes = await app.inject({
      method: "POST",
      url: `/v1/admin/posts/${postBrandB._id.toHexString()}/cancel`,
      headers: authHeader(brandAAdmin.token),
    });
    expect(cancelRes.statusCode).toBe(404);

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/v1/admin/posts/${postBrandB._id.toHexString()}`,
      headers: authHeader(brandAAdmin.token),
    });
    expect(deleteRes.statusCode).toBe(404);
  });

  it("Brand A's admin cannot list or provision users onto Brand B, and does not see Brand B's members", async () => {
    const brandBUser = await seedMember(app, {
      orgId: org.orgId,
      workspaceId: brandB,
      email: "brand-b-member@multibrand.test",
      workspaceRole: "editor",
    });

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/admin/users",
      headers: authHeader(brandAAdmin.token),
    });
    expect(listRes.statusCode).toBe(200);
    const ids: string[] = listRes.json().data.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(brandBUser.userId);

    const createRes = await app.inject({
      method: "POST",
      url: "/v1/admin/users",
      headers: authHeader(brandAAdmin.token),
      payload: {
        name: "Sneaky Hire",
        email: "sneaky@multibrand.test",
        password: "password123",
        workspaceId: brandB,
        workspaceRole: "editor",
      },
    });
    expect(createRes.statusCode).toBe(403);

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/v1/admin/users/${brandBUser.userId}`,
      headers: authHeader(brandAAdmin.token),
      payload: { status: "suspended" },
    });
    expect(patchRes.statusCode).toBe(404);
  });

  it("Brand A's admin cannot create, rename, or archive a workspace (requireOrgOwner only)", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: authHeader(brandAAdmin.token),
      payload: { name: "Brand C" },
    });
    expect(createRes.statusCode).toBe(403);

    const renameRes = await app.inject({
      method: "PATCH",
      url: `/v1/workspaces/${brandB}`,
      headers: authHeader(brandAAdmin.token),
      payload: { name: "hijacked" },
    });
    expect(renameRes.statusCode).toBe(403);

    const archiveRes = await app.inject({
      method: "DELETE",
      url: `/v1/workspaces/${brandB}`,
      headers: authHeader(brandAAdmin.token),
    });
    expect(archiveRes.statusCode).toBe(403);
  });

  it("Brand A's admin sees only Brand A in /v1/workspaces, not Brand B", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workspaces",
      headers: authHeader(brandAAdmin.token),
    });
    expect(res.statusCode).toBe(200);
    const ids: string[] = res.json().data.map((w: { id: string }) => w.id);
    expect(ids).toContain(org.workspaceId);
    expect(ids).not.toContain(brandB);
  });

  // ── Property 2: org owner reaches every workspace in their org, none outside ──

  it("the org owner reaches both Brand A and Brand B", async () => {
    const forgedToken = app.jwt.sign(
      { sub: org.ownerId, orgId: org.orgId, workspaceId: brandB },
      { expiresIn: "15m" },
    );
    const res = await app.inject({
      method: "GET",
      url: "/v1/posts",
      headers: authHeader(forgedToken),
    });
    expect(res.statusCode).toBe(200);

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/workspaces",
      headers: authHeader(org.ownerToken),
    });
    const ids: string[] = listRes.json().data.map((w: { id: string }) => w.id);
    expect(ids.sort()).toEqual([org.workspaceId, brandB].sort());
  });

  it("the org owner can create a workspace and provision a user onto Brand B", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: authHeader(org.ownerToken),
      payload: { name: "Brand C" },
    });
    expect(createRes.statusCode).toBe(201);

    const provisionRes = await app.inject({
      method: "POST",
      url: "/v1/admin/users",
      headers: authHeader(org.ownerToken),
      payload: {
        name: "Brand B Hire",
        email: "brand-b-hire@multibrand.test",
        password: "password123",
        workspaceId: brandB,
        workspaceRole: "editor",
      },
    });
    expect(provisionRes.statusCode).toBe(201);
  });

  it("the org owner does NOT reach a workspace outside their own organization", async () => {
    const otherOrg = await seedOrg(app, { orgName: "Unrelated Org", ownerEmail: "owner@unrelated.test" });
    const forgedToken = app.jwt.sign(
      { sub: org.ownerId, orgId: org.orgId, workspaceId: otherOrg.workspaceId },
      { expiresIn: "15m" },
    );
    const res = await app.inject({
      method: "GET",
      url: "/v1/posts",
      headers: authHeader(forgedToken),
    });
    expect(res.statusCode).toBe(403);
  });

  // ── Property 3: no customer role — owner included — reaches platform routes ──

  const platformRoutes: Array<{
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    url: string;
    payload?: Record<string, unknown>;
  }> = [
    { method: "GET", url: "/v1/admin/llm-configs" },
    { method: "POST", url: "/v1/admin/llm-configs", payload: { label: "x", provider: "openai", apiKey: "sk-x" } },
    { method: "GET", url: "/v1/admin/node-config" },
    { method: "PUT", url: "/v1/admin/node-config", payload: { assignments: {} } },
    { method: "GET", url: "/v1/admin/database/collections" },
    { method: "GET", url: "/v1/admin/database/collections/users/docs" },
    { method: "POST", url: "/v1/platform/tenants", payload: { organizationName: "x", ownerName: "x", ownerEmail: "x@x.test", ownerPassword: "password123" } },
    { method: "GET", url: "/v1/platform/tenants" },
  ];

  it.each(platformRoutes)("org owner ($method $url) is refused — platform-only", async ({ method, url, payload }) => {
    const res = await app.inject({ method, url, headers: authHeader(org.ownerToken), payload });
    expect(res.statusCode).toBe(403);
  });

  it.each(platformRoutes)("workspace admin ($method $url) is refused — platform-only", async ({ method, url, payload }) => {
    const res = await app.inject({ method, url, headers: authHeader(brandAAdmin.token), payload });
    expect(res.statusCode).toBe(403);
  });

  it("platform root DOES reach every platform-only route", async () => {
    const root = await seedPlatformRoot(app);
    for (const { method, url, payload } of platformRoutes) {
      const res = await app.inject({ method, url, headers: authHeader(root.token), payload });
      expect(res.statusCode, `${method} ${url}`).toBeLessThan(400);
    }
  });

  it("platform root also reaches any tenant's workspace-scoped routes", async () => {
    const forgedToken = app.jwt.sign(
      { sub: (await seedPlatformRoot(app, "root2@platform.test")).userId, orgId: "", workspaceId: brandB },
      { expiresIn: "15m" },
    );
    const res = await app.inject({
      method: "GET",
      url: "/v1/posts",
      headers: authHeader(forgedToken),
    });
    expect(res.statusCode).toBe(200);
  });
});
