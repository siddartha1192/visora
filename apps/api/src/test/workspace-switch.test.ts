import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { Types } from "mongoose";
import {
  buildTestApp,
  seedOrg,
  seedMember,
  addWorkspace,
  authHeader,
  type SeededOrg,
} from "./helpers.js";
import { PostModel, UserModel } from "../db/models/index.js";

vi.mock("../queue/post-queue.js", () => import("./mock-queue.js"));

describe("workspace switch", () => {
  let app: FastifyInstance;
  let org: SeededOrg; // org.workspaceId === Brand A
  let brandB: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    org = await seedOrg(app, { orgName: "Switcher Co", ownerEmail: "owner@switcher.test", workspaceName: "Brand A" });
    brandB = await addWorkspace(org.orgId, "Brand B", org.ownerId);
  });

  it("the org owner can switch into a second workspace and immediately see its data with the new token", async () => {
    const brandBPost = await PostModel.create({
      workspaceId: new Types.ObjectId(brandB),
      authorId: new Types.ObjectId(org.ownerId),
      workflow: "passthrough",
      status: "pending_review",
      targets: [],
    });

    // Owner's token is bound to Brand A (the default workspace) — /v1/posts
    // must not see Brand B's post yet.
    const before = await app.inject({ method: "GET", url: "/v1/posts", headers: authHeader(org.ownerToken) });
    expect(before.statusCode).toBe(200);
    expect(before.json().data.items.map((p: { id: string }) => p.id)).not.toContain(
      brandBPost._id.toHexString(),
    );

    const switchRes = await app.inject({
      method: "POST",
      url: "/v1/workspaces/switch",
      headers: authHeader(org.ownerToken),
      payload: { workspaceId: brandB },
    });
    expect(switchRes.statusCode).toBe(200);
    const { accessToken, workspaceId } = switchRes.json().data;
    expect(workspaceId).toBe(brandB);

    const after = await app.inject({ method: "GET", url: "/v1/posts", headers: authHeader(accessToken) });
    expect(after.statusCode).toBe(200);
    expect(after.json().data.items.map((p: { id: string }) => p.id)).toContain(
      brandBPost._id.toHexString(),
    );

    // The switch persists as the user's default so a fresh login lands there.
    const user = await UserModel.findById(org.ownerId).select("defaultWorkspaceId").lean();
    expect(user!.defaultWorkspaceId!.toString()).toBe(brandB);
  });

  it("a workspace admin (no org-owner reach) can only switch into workspaces they hold a membership on", async () => {
    const brandAAdmin = await seedMember(app, {
      orgId: org.orgId,
      workspaceId: org.workspaceId,
      email: "admin@switcher.test",
      workspaceRole: "admin",
    });

    const deniedRes = await app.inject({
      method: "POST",
      url: "/v1/workspaces/switch",
      headers: authHeader(brandAAdmin.token),
      payload: { workspaceId: brandB },
    });
    expect(deniedRes.statusCode).toBe(403);

    // Grant explicit membership on Brand B, then the switch succeeds.
    await UserModel.updateOne(
      { _id: brandAAdmin.userId },
      { $push: { workspaces: { workspaceId: new Types.ObjectId(brandB), role: "viewer" } } },
    );
    const allowedRes = await app.inject({
      method: "POST",
      url: "/v1/workspaces/switch",
      headers: authHeader(brandAAdmin.token),
      payload: { workspaceId: brandB },
    });
    expect(allowedRes.statusCode).toBe(200);
  });

  it("rejects switching to a workspace that does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workspaces/switch",
      headers: authHeader(org.ownerToken),
      payload: { workspaceId: new Types.ObjectId().toHexString() },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a malformed workspaceId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workspaces/switch",
      headers: authHeader(org.ownerToken),
      payload: { workspaceId: "not-an-object-id" },
    });
    expect(res.statusCode).toBe(400);
  });
});
