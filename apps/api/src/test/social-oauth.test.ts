import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, seedOrg, seedMember, authHeader, type SeededOrg } from "./helpers.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { WorkspaceModel } from "../db/models/index.js";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext string", () => {
    const ciphertext = encryptSecret("a-real-oauth-token-value");
    expect(ciphertext).not.toContain("a-real-oauth-token-value");
    expect(decryptSecret(ciphertext)).toBe("a-real-oauth-token-value");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-input");
    expect(decryptSecret(b)).toBe("same-input");
  });

  it("throws when the ciphertext has been tampered with", () => {
    const ciphertext = encryptSecret("original-token");
    const tampered = ciphertext.slice(0, -4) + "abcd";
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe("social OAuth connect/disconnect authorization", () => {
  let app: FastifyInstance;
  let orgA: SeededOrg;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    orgA = await seedOrg(app, { orgName: "Social Org A", ownerEmail: "owner-social@test.com" });
  });

  it("rejects a non-owner workspace member from starting the connect flow", async () => {
    const member = await seedMember(app, {
      orgId: orgA.orgId,
      workspaceId: orgA.workspaceId,
      email: "member-social@test.com",
      workspaceRole: "admin",
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${orgA.workspaceId}/social/instagram/connect`,
      headers: authHeader(member.token),
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a non-owner from disconnecting", async () => {
    const member = await seedMember(app, {
      orgId: orgA.orgId,
      workspaceId: orgA.workspaceId,
      email: "member-social-2@test.com",
      workspaceRole: "admin",
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workspaces/${orgA.workspaceId}/social/instagram`,
      headers: authHeader(member.token),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404s when the org owner targets a workspace outside their own org", async () => {
    const orgB = await seedOrg(app, { orgName: "Social Org B", ownerEmail: "owner-social-b@test.com" });

    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${orgB.workspaceId}/social/instagram/connect`,
      headers: authHeader(orgA.ownerToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns a Meta authorization URL for the org owner", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${orgA.workspaceId}/social/instagram/connect`,
      headers: authHeader(orgA.ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const { authorizationUrl } = res.json().data;
    expect(authorizationUrl).toContain("https://www.facebook.com");
    expect(authorizationUrl).toContain("client_id=test-meta-app-id");
    expect(authorizationUrl).toContain("state=");
  });

  it("disconnect 404s when there is nothing connected for that platform", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workspaces/${orgA.workspaceId}/social/instagram`,
      headers: authHeader(orgA.ownerToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("disconnect clears the stored ciphertext and marks the account revoked", async () => {
    await WorkspaceModel.updateOne(
      { _id: orgA.workspaceId },
      {
        $push: {
          socialAccounts: {
            platform: "instagram",
            handle: "test_account",
            externalAccountId: "123456",
            encryptedAccessToken: encryptSecret("some-real-token"),
            status: "connected",
          },
        },
      },
    );

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workspaces/${orgA.workspaceId}/social/instagram`,
      headers: authHeader(orgA.ownerToken),
    });
    expect(res.statusCode).toBe(200);

    const ws = await WorkspaceModel.findById(orgA.workspaceId).lean();
    const account = ws?.socialAccounts.find((a) => a.platform === "instagram");
    expect(account?.status).toBe("revoked");
    expect(account?.encryptedAccessToken).toBeFalsy();
  });
});

describe("social OAuth callback (public)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("redirects to /settings with an error when Meta reports the user cancelled", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/social/callback?error=access_denied",
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("/settings?error=");
  });

  it("redirects to /settings with an error when state is missing or malformed", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/social/callback?code=somecode&state=garbage",
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("/settings?error=");
  });
});
