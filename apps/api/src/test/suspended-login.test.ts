import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Types } from "mongoose";
import { buildTestApp, seedOrg, signRefreshToken, type SeededOrg } from "./helpers.js";
import { OrganizationModel, UserModel } from "../db/models/index.js";

/**
 * Verification #4 from the design doc, plus the specific claim that refresh
 * was fixed to re-check status on every call rather than trusting a 30-day
 * token forever. Both checks live in modules/auth/auth.service.ts
 * (verifyCredentials) and http/controllers/auth.controller.ts (refresh).
 */
describe("suspended login", () => {
  let app: FastifyInstance;
  let org: SeededOrg;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /v1/auth/login is refused once the user is suspended", async () => {
    org = await seedOrg(app, { orgName: "Suspend Co", ownerEmail: "owner@suspend.test" });

    const before = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "owner@suspend.test", password: "password123" },
    });
    expect(before.statusCode).toBe(200);

    await UserModel.updateOne({ _id: new Types.ObjectId(org.ownerId) }, { $set: { status: "suspended" } });

    const after = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "owner@suspend.test", password: "password123" },
    });
    expect(after.statusCode).toBe(403);
  });

  it("an already-issued refresh token is refused on /v1/auth/refresh once the account is suspended", async () => {
    org = await seedOrg(app, { orgName: "Suspend Refresh Co", ownerEmail: "owner@suspend-refresh.test" });

    const refreshToken = signRefreshToken(app, {
      sub: org.ownerId,
      orgId: org.orgId,
      workspaceId: org.workspaceId,
    });

    // Token is valid and account is active — refresh succeeds.
    const before = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken },
    });
    expect(before.statusCode).toBe(200);

    // Suspend after the token was issued — this is the regression: a 30-day
    // refresh token must not keep minting access tokens once suspended.
    await UserModel.updateOne({ _id: new Types.ObjectId(org.ownerId) }, { $set: { status: "suspended" } });

    const after = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken },
    });
    expect(after.statusCode).toBe(403);
  });

  it("an already-issued refresh token is refused once the user's whole organization is suspended", async () => {
    org = await seedOrg(app, { orgName: "Suspend Org Co", ownerEmail: "owner@suspend-org.test" });

    const refreshToken = signRefreshToken(app, {
      sub: org.ownerId,
      orgId: org.orgId,
      workspaceId: org.workspaceId,
    });

    // Login re-checks organization status; refresh (per auth.controller.ts)
    // only re-checks the user's own `status` field, not the org's — suspending
    // the org is mirrored onto every member's `status` by setTenantStatus
    // (platform.controller.ts), so exercise that path directly rather than
    // asserting refresh queries Organization itself.
    await UserModel.updateOne({ _id: new Types.ObjectId(org.ownerId) }, { $set: { status: "suspended" } });
    await OrganizationModel.updateOne({ _id: new Types.ObjectId(org.orgId) }, { $set: { status: "suspended" } });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it("login is refused once the user's organization is suspended, even though the user's own status is still active", async () => {
    org = await seedOrg(app, { orgName: "Suspend Org Only Co", ownerEmail: "owner@suspend-org-only.test" });
    await OrganizationModel.updateOne({ _id: new Types.ObjectId(org.orgId) }, { $set: { status: "suspended" } });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "owner@suspend-org-only.test", password: "password123" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("a suspended user cannot reach any authenticated route with an already-issued access token", async () => {
    org = await seedOrg(app, { orgName: "Suspend Access Co", ownerEmail: "owner@suspend-access.test" });

    await UserModel.updateOne({ _id: new Types.ObjectId(org.ownerId) }, { $set: { status: "suspended" } });

    const res = await app.inject({
      method: "GET",
      url: "/v1/posts",
      headers: { authorization: `Bearer ${org.ownerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
