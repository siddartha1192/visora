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

  const edited = await ctx.services.imageGenerator.edit({
    source: original.body,
    sourceMime: original.contentType,
    instructions,
  });

  const { ref, url } = await storeImageAsset({
    services: ctx.services,
    workspaceId: state.workspaceId,
    jobId: state.jobId,
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
