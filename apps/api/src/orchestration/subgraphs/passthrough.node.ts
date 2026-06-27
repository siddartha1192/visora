import { Types } from "mongoose";
import { AssetModel } from "../../db/models/index.js";
import { defineNode } from "../context.js";

/**
 * Workflow 1 — Direct Pass-Through. The user already uploaded the asset (via the
 * assets endpoint -> object store). We just load it and expose it as the primary
 * asset so optimization can proceed. No AI/provider cost.
 */
export const passthroughNode = defineNode("passthrough", async (state, ctx) => {
  const assetId = state.input.uploadedAssetId;
  if (!assetId) throw new Error("passthrough: uploadedAssetId is required");

  const asset = await AssetModel.findById(new Types.ObjectId(assetId));
  if (!asset?.s3) throw new Error(`passthrough: asset ${assetId} not found`);

  const url = await ctx.services.objectStore.signedUrl(asset.s3.key, 3600);

  return {
    rawAsset: {
      assetId: asset._id.toHexString(),
      s3Key: asset.s3.key,
      bucket: asset.s3.bucket,
      region: asset.s3.region,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      bytes: asset.bytes,
    },
    primaryAssetUrl: url,
  };
});
