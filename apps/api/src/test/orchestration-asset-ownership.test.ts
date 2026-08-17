import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mongoose, { Types } from "mongoose";
import { AssetModel } from "../db/models/index.js";
import { passthroughNode } from "../orchestration/subgraphs/passthrough.node.js";
import { enhancementNode } from "../orchestration/subgraphs/enhancement.node.js";
import type { GraphStateType } from "../orchestration/state.js";
import type { ServiceContainer } from "../config/container.js";

/**
 * REGRESSION test for the second Phase 0 leak: `passthrough.node.ts` and
 * `enhancement.node.ts` load `state.input.uploadedAssetId` — a value that
 * comes straight from the request body of whichever workspace created the
 * post — and previously did `AssetModel.findById(assetId)` with no ownership
 * check, so Workspace A could reference Workspace B's asset id and have the
 * pipeline fetch and republish B's image.
 *
 * These nodes run inside the LangGraph worker, off a BullMQ job — reachable
 * only through the async pipeline, not synchronously through the HTTP layer
 * (see two-org-isolation.test.ts for why the equivalent POST /v1/posts check
 * can only assert the request is *accepted*, not that the asset resolves).
 * Testing the node functions directly is what actually proves the fix: both
 * are plain functions exported from `defineNode`, so they can be invoked with
 * a minimal state + service container without spinning up Redis or a worker.
 */

const fakeServices = {
  objectStore: {
    bucket: "test-bucket",
    region: "us-east-1",
    async put() {
      throw new Error("not used in this test");
    },
    async get() {
      return { body: Buffer.from("fake-bytes"), contentType: "image/png" };
    },
    async signedUrl(key: string) {
      return `https://example.test/signed/${key}`;
    },
  },
} as unknown as ServiceContainer;

function baseState(overrides: Partial<GraphStateType>): GraphStateType {
  return {
    workspaceId: "",
    postId: new Types.ObjectId().toHexString(),
    jobId: new Types.ObjectId().toHexString(),
    threadId: "test-thread",
    workflow: "passthrough",
    authorEmail: undefined,
    input: {},
    targets: [],
    resolvedWorkflow: undefined,
    captionRequest: { hashtags: [], generate: false },
    scheduleMode: "instant",
    rawAsset: undefined,
    candidateAssets: undefined,
    processedAsset: undefined,
    primaryAssetUrl: undefined,
    approvalStatus: undefined,
    variants: undefined,
    caption: undefined,
    published: [],
    errors: [],
    usage: [],
    seq: 0,
    status: "running",
    ...overrides,
  } as GraphStateType;
}

function config(services: ServiceContainer) {
  return { configurable: { services, nodeAdapters: {} } } as never;
}

describe("orchestration node asset ownership", () => {
  let workspaceA: Types.ObjectId;
  let workspaceB: Types.ObjectId;
  let assetInB: InstanceType<typeof AssetModel>;

  beforeAll(async () => {
    workspaceA = new Types.ObjectId();
    workspaceB = new Types.ObjectId();
    assetInB = await AssetModel.create({
      workspaceId: workspaceB,
      kind: "upload",
      origin: { source: "user" },
      s3: { bucket: "b", key: "workspace-b/secret.png", region: "us-east-1" },
      mime: "image/png",
    });
  });

  afterAll(async () => {
    await mongoose.connection.collections["assets"]?.deleteMany({});
  });

  it("REGRESSION: passthroughNode throws rather than resolving another workspace's asset", async () => {
    const state = baseState({
      workspaceId: workspaceA.toHexString(),
      workflow: "passthrough",
      input: { uploadedAssetId: assetInB._id.toHexString() },
    });

    await expect(passthroughNode(state, config(fakeServices))).rejects.toThrow(/not found/i);
  });

  it("passthroughNode succeeds when the asset actually belongs to the caller's workspace", async () => {
    const ownAsset = await AssetModel.create({
      workspaceId: workspaceA,
      kind: "upload",
      origin: { source: "user" },
      s3: { bucket: "b", key: "workspace-a/own.png", region: "us-east-1" },
      mime: "image/png",
    });

    const state = baseState({
      workspaceId: workspaceA.toHexString(),
      workflow: "passthrough",
      input: { uploadedAssetId: ownAsset._id.toHexString() },
    });

    const result = await passthroughNode(state, config(fakeServices));
    expect(result.rawAsset?.assetId).toBe(ownAsset._id.toHexString());
    expect(result.primaryAssetUrl).toContain("workspace-a/own.png");
  });

  it("REGRESSION: enhancementNode throws rather than resolving another workspace's asset", async () => {
    const state = baseState({
      workspaceId: workspaceA.toHexString(),
      workflow: "ai_enhance",
      input: {
        uploadedAssetId: assetInB._id.toHexString(),
        instructions: "make the sky purple",
      },
    });

    await expect(enhancementNode(state, config(fakeServices))).rejects.toThrow(/not found/i);
  });
});
