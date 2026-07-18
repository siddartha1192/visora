/**
 * FILE: enhancement.node.ts
 * Workflow 3 — modifies an existing uploaded image using AI.
 * The user provides an image + written instructions (e.g. "make the sky purple").
 * This node fetches the original image bytes from S3, sends them to DALL·E's edit
 * endpoint with the instructions, then stores the modified result as a new "enhanced" asset.
 */
import { Types } from "mongoose";
import { AssetModel } from "../../db/models/index.js";
import { defineNode } from "../context.js";
import { storeImageAsset } from "../asset-helper.js";

/**
 * Workflow 3 — AI Enhancement / Modification. Loads the user's source image,
 * applies the modification instructions via the ImageGenerator.edit port
 * (DALL·E edit / inpaint), then stores the result as a new "enhanced" asset.
 */
export const enhancementNode = defineNode("enhancement", async (state, ctx) => {
  const assetId = state.input.uploadedAssetId;
  const instructions = state.input.instructions;
  if (!assetId) throw new Error("enhancement: uploadedAssetId is required");
  if (!instructions) throw new Error("enhancement: instructions are required");

  const source = await AssetModel.findById(new Types.ObjectId(assetId));
  if (!source?.s3) throw new Error(`enhancement: asset ${assetId} not found`);

  const original = await ctx.services.objectStore.get(source.s3.key);

  const ig = ctx.nodeAdapters?.enhancement?.imageGenerator ?? ctx.services.imageGenerator;
  const edited = await ig.edit({
    source: original.body,
    sourceMime: original.contentType,
    instructions,
  });

  const { ref, url } = await storeImageAsset({
    services: ctx.services,
    workspaceId: state.workspaceId,
    jobId: state.jobId,
    authorEmail: state.authorEmail,
    bytes: edited.bytes,
    mime: edited.mime,
    width: edited.width,
    height: edited.height,
    kind: "enhanced",
    source: "dalle3",
    origin: { prompt: instructions, sourceUrl: source.s3.key },
  });

  return {
    processedAsset: ref,
    primaryAssetUrl: url,
    usage: [
      {
        node: "enhancement",
        provider: edited.usage.provider,
        model: edited.usage.model,
        imagesGenerated: edited.usage.imagesGenerated,
      },
    ],
  };
});
