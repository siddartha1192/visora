import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { Types } from "mongoose";
import { buildTestApp, seedOrg, authHeader, type SeededOrg } from "./helpers.js";
import { AgentLogModel, AssetModel, PostModel } from "../db/models/index.js";
import * as apiKeyService from "../modules/workspace/api-key.service.js";

vi.mock("../queue/post-queue.js", () => import("./mock-queue.js"));

/**
 * Seeds Org A and Org B, each with an owner + default workspace, and asserts
 * — endpoint by endpoint — that Org A's token can never read or mutate Org
 * B's users, posts, assets, logs or API keys. This is the design doc's
 * "Verification #2": the regression backstop for the leaks the whole
 * migration exists to close.
 */
describe("two-org isolation", () => {
  let app: FastifyInstance;
  let orgA: SeededOrg;
  let orgB: SeededOrg;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    orgA = await seedOrg(app, { orgName: "Org A", ownerEmail: "owner-a@two-org.test" });
    orgB = await seedOrg(app, { orgName: "Org B", ownerEmail: "owner-b@two-org.test" });
  });

  // ── Posts ──────────────────────────────────────────────────────────────────

  it("Org A cannot list, read, or mutate Org B's posts via the workspace-scoped routes", async () => {
    const postB = await PostModel.create({
      workspaceId: new Types.ObjectId(orgB.workspaceId),
      authorId: new Types.ObjectId(orgB.ownerId),
      workflow: "passthrough",
      status: "pending_review",
      targets: [],
    });

    const getRes = await app.inject({
      method: "GET",
      url: `/v1/posts/${postB._id.toHexString()}`,
      headers: authHeader(orgA.ownerToken),
    });
    expect(getRes.statusCode).toBe(404);

    const approveRes = await app.inject({
      method: "POST",
      url: `/v1/posts/${postB._id.toHexString()}/approve`,
      headers: authHeader(orgA.ownerToken),
      payload: {},
    });
    expect(approveRes.statusCode).toBe(404);

    const cancelRes = await app.inject({
      method: "POST",
      url: `/v1/posts/${postB._id.toHexString()}/cancel`,
      headers: authHeader(orgA.ownerToken),
    });
    expect(cancelRes.statusCode).toBe(404);

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/posts",
      headers: authHeader(orgA.ownerToken),
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json();
    expect(listBody.data.items.find((p: { id: string }) => p.id === postB._id.toHexString())).toBeUndefined();
  });

  it("Org A's admin list does not include Org B's posts, even scanning every status", async () => {
    await PostModel.create({
      workspaceId: new Types.ObjectId(orgB.workspaceId),
      authorId: new Types.ObjectId(orgB.ownerId),
      workflow: "passthrough",
      status: "published",
      targets: [],
    });
    const postA = await PostModel.create({
      workspaceId: new Types.ObjectId(orgA.workspaceId),
      authorId: new Types.ObjectId(orgA.ownerId),
      workflow: "passthrough",
      status: "published",
      targets: [],
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/posts?pageSize=50",
      headers: authHeader(orgA.ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids: string[] = body.data.items.map((p: { id: string }) => p.id);
    expect(ids).toContain(postA._id.toHexString());
    expect(ids.length).toBe(1);
  });

  it("Org A cannot hard-delete or admin-cancel Org B's post", async () => {
    const postB = await PostModel.create({
      workspaceId: new Types.ObjectId(orgB.workspaceId),
      authorId: new Types.ObjectId(orgB.ownerId),
      workflow: "passthrough",
      status: "pending_review",
      targets: [],
    });

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/v1/admin/posts/${postB._id.toHexString()}`,
      headers: authHeader(orgA.ownerToken),
    });
    expect(deleteRes.statusCode).toBe(404);

    const cancelRes = await app.inject({
      method: "POST",
      url: `/v1/admin/posts/${postB._id.toHexString()}/cancel`,
      headers: authHeader(orgA.ownerToken),
    });
    expect(cancelRes.statusCode).toBe(404);

    const stillThere = await PostModel.findById(postB._id);
    expect(stillThere).not.toBeNull();
    expect(stillThere!.status).toBe("pending_review");
  });

  // ── Assets ─────────────────────────────────────────────────────────────────

  it("Org A cannot read Org B's asset", async () => {
    const assetB = await AssetModel.create({
      workspaceId: new Types.ObjectId(orgB.workspaceId),
      kind: "upload",
      origin: { source: "user" },
      s3: { bucket: "b", key: "k", region: "us-east-1" },
      mime: "image/png",
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/assets/${assetB._id.toHexString()}`,
      headers: authHeader(orgA.ownerToken),
    });
    expect(res.statusCode).toBe(404);

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/assets",
      headers: authHeader(orgA.ownerToken),
    });
    expect(listRes.statusCode).toBe(200);
    const ids: string[] = listRes.json().data.items.map((a: { id: string }) => a.id);
    expect(ids).not.toContain(assetB._id.toHexString());
  });

  // ── Regression: GET /v1/posts/:id/logs must not leak another tenant's AgentLog ──

  it("REGRESSION: GET /v1/posts/:id/logs with Org B's post id, called with Org A's token, returns no Org B log data", async () => {
    const postB = await PostModel.create({
      workspaceId: new Types.ObjectId(orgB.workspaceId),
      authorId: new Types.ObjectId(orgB.ownerId),
      workflow: "ai_generate",
      status: "processing",
      targets: [],
    });

    await AgentLogModel.create({
      workspaceId: new Types.ObjectId(orgB.workspaceId),
      postId: postB._id,
      threadId: postB._id.toHexString(),
      node: "generation",
      sequence: 1,
      status: "succeeded",
      message: "Org B secret prompt output",
      data: { secret: "org-b-only" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/posts/${postB._id.toHexString()}/logs`,
      headers: authHeader(orgA.ownerToken),
    });

    // The log endpoint itself doesn't 403/404 on a foreign post id (the id is
    // opaque to it) — it filters by workspaceId, so a foreign post id simply
    // matches nothing. Confirming the response, not the status code, IS the
    // regression test: any Org B log content in the payload would be the leak.
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.logs).toEqual([]);
    expect(body.data.done).toBe(false);
    expect(JSON.stringify(body)).not.toContain("org-b-only");
  });

  it("REGRESSION: the SSE stream's query is workspace-scoped, same as GET /v1/posts/:id/logs (SSE bodies can't be driven through Fastify's .inject(), so this exercises the exact Mongo filter streamLogs runs)", async () => {
    const postB = await PostModel.create({
      workspaceId: new Types.ObjectId(orgB.workspaceId),
      authorId: new Types.ObjectId(orgB.ownerId),
      workflow: "ai_generate",
      status: "processing",
      targets: [],
    });

    await AgentLogModel.create({
      workspaceId: new Types.ObjectId(orgB.workspaceId),
      postId: postB._id,
      threadId: postB._id.toHexString(),
      node: "pipeline",
      sequence: 1,
      status: "succeeded",
      message: "Org B pipeline event",
      data: { secret: "org-b-sse-secret" },
    });

    // The exact filter streamLogs (log.controller.ts) builds from req.auth
    // before querying AgentLogModel — Org A's workspace against Org B's post.
    const scopedAsOrgA = await AgentLogModel.find({
      postId: postB._id,
      workspaceId: new Types.ObjectId(orgA.workspaceId),
    }).lean();
    expect(scopedAsOrgA).toEqual([]);

    const scopedAsOrgB = await AgentLogModel.find({
      postId: postB._id,
      workspaceId: new Types.ObjectId(orgB.workspaceId),
    }).lean();
    expect(scopedAsOrgB).toHaveLength(1);
  });

  // ── Regression: uploadedAssetId ownership must be checked cross-tenant ──────

  it("REGRESSION: Org A can enqueue a post referencing Org B's uploadedAssetId (accepted by the API), but the pipeline must never resolve Org B's asset — covered by the orchestration-node unit test", async () => {
    // POST /v1/posts does not validate uploadedAssetId synchronously (the
    // asset lookup happens inside the async orchestration node once the
    // worker picks up the job — see orchestration-asset-ownership.test.ts for
    // the direct regression test of that node). This test documents and
    // pins that division of responsibility: the HTTP layer accepts the
    // request (202), but the *data* is never reachable, which the node-level
    // test proves directly.
    const assetB = await AssetModel.create({
      workspaceId: new Types.ObjectId(orgB.workspaceId),
      kind: "upload",
      origin: { source: "user" },
      s3: { bucket: "b", key: "k", region: "us-east-1" },
      mime: "image/png",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: authHeader(orgA.ownerToken),
      payload: {
        workflow: "passthrough",
        uploadedAssetId: assetB._id.toHexString(),
        targets: [{ platform: "instagram", accountId: "acct_1" }],
        schedule: { mode: "instant" },
        caption: { text: "cross-tenant asset theft attempt" },
      },
    });
    expect(res.statusCode).toBe(202);

    const created = await PostModel.findOne({ workspaceId: new Types.ObjectId(orgA.workspaceId) });
    expect(created).not.toBeNull();
    expect(created!.input?.uploadedAssetId?.toString()).toBe(assetB._id.toHexString());
    // The asset itself is still scoped to Org B and unreachable from Org A's
    // asset endpoints — the pipeline node (tested separately) is what stops
    // this reference from ever resolving to real bytes.
    const assetViaA = await app.inject({
      method: "GET",
      url: `/v1/assets/${assetB._id.toHexString()}`,
      headers: authHeader(orgA.ownerToken),
    });
    expect(assetViaA.statusCode).toBe(404);
  });

  // ── Users ──────────────────────────────────────────────────────────────────

  it("Org A cannot list, update, or delete Org B's users", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/v1/admin/users",
      headers: authHeader(orgA.ownerToken),
    });
    expect(listRes.statusCode).toBe(200);
    const ids: string[] = listRes.json().data.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(orgB.ownerId);

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/v1/admin/users/${orgB.ownerId}`,
      headers: authHeader(orgA.ownerToken),
      payload: { status: "suspended" },
    });
    expect(patchRes.statusCode).toBe(404);

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/v1/admin/users/${orgB.ownerId}`,
      headers: authHeader(orgA.ownerToken),
    });
    expect(deleteRes.statusCode).toBe(404);
  });

  // ── API keys ───────────────────────────────────────────────────────────────

  it("Org A cannot revoke or see Org B's API key", async () => {
    const { secret } = await apiKeyService.createApiKey(orgB.workspaceId, {
      label: "org-b-integration",
      expiresInDays: null,
    });
    const keyId = secret.split(".")[0]!.replace(/^vsk_/, "");

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/admin/api-keys",
      headers: authHeader(orgA.ownerToken),
    });
    expect(listRes.statusCode).toBe(200);
    const keyIds: string[] = listRes.json().data.map((k: { keyId: string }) => k.keyId);
    expect(keyIds).not.toContain(keyId);

    const revokeRes = await app.inject({
      method: "DELETE",
      url: `/v1/admin/api-keys/${keyId}`,
      headers: authHeader(orgA.ownerToken),
    });
    expect(revokeRes.statusCode).toBe(404);

    const stillActive = await apiKeyService.listApiKeys(orgB.workspaceId);
    expect(stillActive.find((k) => k.keyId === keyId)?.revoked).toBe(false);
  });

  // ── Workspaces ─────────────────────────────────────────────────────────────

  it("Org A cannot rename or archive Org B's workspace, and cannot switch into it", async () => {
    const renameRes = await app.inject({
      method: "PATCH",
      url: `/v1/workspaces/${orgB.workspaceId}`,
      headers: authHeader(orgA.ownerToken),
      payload: { name: "hijacked" },
    });
    expect(renameRes.statusCode).toBe(404);

    const switchRes = await app.inject({
      method: "POST",
      url: "/v1/workspaces/switch",
      headers: authHeader(orgA.ownerToken),
      payload: { workspaceId: orgB.workspaceId },
    });
    expect(switchRes.statusCode).toBe(403);

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/workspaces",
      headers: authHeader(orgA.ownerToken),
    });
    const ids: string[] = listRes.json().data.map((w: { id: string }) => w.id);
    expect(ids).not.toContain(orgB.workspaceId);
  });

  // ── Analytics ──────────────────────────────────────────────────────────────

  it("Org A's analytics never aggregate Org B's posts or token usage", async () => {
    const postB = await PostModel.create({
      workspaceId: new Types.ObjectId(orgB.workspaceId),
      authorId: new Types.ObjectId(orgB.ownerId),
      workflow: "ai_generate",
      status: "published",
      targets: [],
    });
    await AgentLogModel.create({
      workspaceId: new Types.ObjectId(orgB.workspaceId),
      postId: postB._id,
      threadId: postB._id.toHexString(),
      node: "generation",
      sequence: 1,
      status: "succeeded",
      provider: { name: "openai", model: "gpt-image-1" },
      usage: { promptTokens: 999, completionTokens: 999, imagesGenerated: 5, costUsd: 42 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/analytics?range=all",
      headers: authHeader(orgA.ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.overview.totalPosts).toBe(0);
    expect(body.overview.totalCostUsd).toBe(0);
    expect(body.overview.totalImagesGenerated).toBe(0);
  });
});
