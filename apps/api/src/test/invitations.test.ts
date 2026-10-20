import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  seedOrg,
  seedMember,
  addWorkspace,
  authHeader,
  type SeededOrg,
} from "./helpers.js";
import { InvitationModel, UserModel } from "../db/models/index.js";

vi.mock("../queue/post-queue.js", () => import("./mock-queue.js"));

describe("workspace invites", () => {
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
    org = await seedOrg(app, { orgName: "Invite Co", ownerEmail: "owner@invite.test", workspaceName: "Brand A" });
    brandB = await addWorkspace(org.orgId, "Brand B", org.ownerId);
    brandAAdmin = await seedMember(app, {
      orgId: org.orgId,
      workspaceId: org.workspaceId,
      email: "brand-a-admin@invite.test",
      workspaceRole: "admin",
    });
  });

  it("a workspace admin can invite onto their own workspace, and the token accepts into it", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${org.workspaceId}/invites`,
      headers: authHeader(brandAAdmin.token),
      payload: { email: "newhire@invite.test", role: "editor" },
    });
    expect(createRes.statusCode).toBe(201);
    const { token } = createRes.json().data;
    expect(typeof token).toBe("string");

    const previewRes = await app.inject({ method: "GET", url: `/v1/invites/${token}` });
    expect(previewRes.statusCode).toBe(200);
    expect(previewRes.json().data.email).toBe("newhire@invite.test");
    expect(previewRes.json().data.role).toBe("editor");

    const acceptRes = await app.inject({
      method: "POST",
      url: `/v1/invites/${token}/accept`,
      payload: { name: "New Hire", password: "password123" },
    });
    expect(acceptRes.statusCode).toBe(201);

    const user = await UserModel.findOne({ email: "newhire@invite.test" });
    expect(user).not.toBeNull();
    expect(user!.orgRole).toBe("member");
    expect(user!.workspaces).toHaveLength(1);
    expect(user!.workspaces[0]!.workspaceId.toString()).toBe(org.workspaceId);
    expect(user!.workspaces[0]!.role).toBe("editor");

    const invite = await InvitationModel.findOne({ email: "newhire@invite.test" });
    expect(invite!.status).toBe("accepted");
  });

  it("a workspace admin CANNOT invite onto a workspace they don't administer (Brand B)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${brandB}/invites`,
      headers: authHeader(brandAAdmin.token),
      payload: { email: "sneaky@invite.test", role: "editor" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("the org owner can invite onto any workspace in their org, including one they don't hold membership on", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${brandB}/invites`,
      headers: authHeader(org.ownerToken),
      payload: { email: "brand-b-hire@invite.test", role: "admin" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("a workspace admin CANNOT list invites on a workspace they don't administer", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/workspaces/${brandB}/invites`,
      headers: authHeader(org.ownerToken),
      payload: { email: "hidden@invite.test", role: "editor" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${brandB}/invites`,
      headers: authHeader(brandAAdmin.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects acceptance of an expired invitation", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${org.workspaceId}/invites`,
      headers: authHeader(brandAAdmin.token),
      payload: { email: "stale@invite.test", role: "viewer" },
    });
    const { token } = createRes.json().data;

    await InvitationModel.updateOne(
      { email: "stale@invite.test" },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    const acceptRes = await app.inject({
      method: "POST",
      url: `/v1/invites/${token}/accept`,
      payload: { name: "Too Late", password: "password123" },
    });
    expect(acceptRes.statusCode).toBe(400);

    const invite = await InvitationModel.findOne({ email: "stale@invite.test" });
    expect(invite!.status).toBe("expired");
  });

  it("rejects an unknown/garbage token on both preview and accept", async () => {
    const previewRes = await app.inject({ method: "GET", url: "/v1/invites/not-a-real-token" });
    expect(previewRes.statusCode).toBe(404);

    const acceptRes = await app.inject({
      method: "POST",
      url: "/v1/invites/not-a-real-token/accept",
      payload: { name: "Nobody", password: "password123" },
    });
    expect(acceptRes.statusCode).toBe(404);
  });

  it("refuses to invite an email that is already registered", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${org.workspaceId}/invites`,
      headers: authHeader(brandAAdmin.token),
      payload: { email: "owner@invite.test", role: "editor" }, // org owner's own email
    });
    expect(res.statusCode).toBe(409);
  });

  it("a revoked invitation can no longer be accepted", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${org.workspaceId}/invites`,
      headers: authHeader(brandAAdmin.token),
      payload: { email: "revoked@invite.test", role: "viewer" },
    });
    const { token } = createRes.json().data;
    const invitationId = createRes.json().data.invitation.id;

    const revokeRes = await app.inject({
      method: "DELETE",
      url: `/v1/invites/${invitationId}`,
      headers: authHeader(brandAAdmin.token),
    });
    expect(revokeRes.statusCode).toBe(200);

    const acceptRes = await app.inject({
      method: "POST",
      url: `/v1/invites/${token}/accept`,
      payload: { name: "Too Slow", password: "password123" },
    });
    expect(acceptRes.statusCode).toBe(404);
  });

  it("a workspace admin cannot revoke an invitation on a workspace they don't administer", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${brandB}/invites`,
      headers: authHeader(org.ownerToken),
      payload: { email: "brandb-target@invite.test", role: "editor" },
    });
    const invitationId = createRes.json().data.invitation.id;

    const revokeRes = await app.inject({
      method: "DELETE",
      url: `/v1/invites/${invitationId}`,
      headers: authHeader(brandAAdmin.token),
    });
    expect(revokeRes.statusCode).toBe(404);
  });

  it("creating a new invite for the same email supersedes the previous pending one", async () => {
    const first = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${org.workspaceId}/invites`,
      headers: authHeader(brandAAdmin.token),
      payload: { email: "resend@invite.test", role: "viewer" },
    });
    const firstToken = first.json().data.token;

    await app.inject({
      method: "POST",
      url: `/v1/workspaces/${org.workspaceId}/invites`,
      headers: authHeader(brandAAdmin.token),
      payload: { email: "resend@invite.test", role: "editor" },
    });

    const acceptOld = await app.inject({
      method: "POST",
      url: `/v1/invites/${firstToken}/accept`,
      payload: { name: "Old Link", password: "password123" },
    });
    expect(acceptOld.statusCode).toBe(404);
  });
});
