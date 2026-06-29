/**
 * FILE: optimization.node.ts
 * Step 3 of the pipeline — resizes the image for every target platform.
 * All 5 workflows converge here; by this point primaryAssetUrl is always set
 * regardless of how the image was produced (AI, stock, upload, scrape).
 * Produces one platform-specific variant per unique target (e.g. Instagram 1080×1080, X 1600×900).
 */
import { PLATFORM_IMAGE_SPECS, type AssetVariant } from "@visora/shared";
import { Types } from "mongoose";
import { defineNode } from "../context.js";

/**
 * Fan-out resize: for each distinct target platform, produce a tailored variant
 * via the MediaOptimizer port (Cloudinary). All five workflows converge here —
 * by this point `primaryAssetUrl` is set regardless of how the image originated.
 */
export const optimizationNode = defineNode("optimization", async (state, ctx) => {
  const sourceUrl = state.primaryAssetUrl;
  const source = state.processedAsset ?? state.rawAsset;
  if (!sourceUrl || !source) {
    throw new Error("optimization: no primary asset available");
  }

  const platforms = Array.from(new Set(state.targets.map((t) => t.platform)));
  const variants: Array<AssetVariant & { variantId: string }> = [];

  for (const platform of platforms) {
    const spec = PLATFORM_IMAGE_SPECS[platform];
    const result = await ctx.services.mediaOptimizer.resizeForPlatform({
      source,
      sourceUrl,
      spec,
    });
    variants.push({
      variantId: new Types.ObjectId().toHexString(),
      platform: result.platform,
      aspectRatio: result.aspectRatio,
      cloudinaryUrl: result.cloudinaryUrl,
      s3Key: result.s3Key,
      width: result.width,
      height: result.height,
    });
  }

  return {
    variants,
    usage: [{ node: "optimization", provider: ctx.services.mediaOptimizer.name }],
  };
});
