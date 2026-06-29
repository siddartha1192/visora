/**
 * FILE: persist.node.ts
 * Step 6 (final) of the pipeline — saves everything to the database and sets the post's final status.
 * Writes the platform variants onto the Asset document, then updates the Post with:
 *  - The caption that was used
 *  - Per-platform publish outcomes (externalPostId, permalink, status)
 * Final status logic:
 *  - Scheduled post (no publish step ran) → "ready"
 *  - Instant post, at least one platform succeeded → "published"
 *  - Instant post, all platforms failed → "failed"
 */
import { Types } from "mongoose";
import { AssetModel, PostModel } from "../../db/models/index.js";
import { defineNode } from "../context.js";

/**
 * Terminal node. Writes variants onto the primary Asset, then updates the Post:
 * captions, per-target outcomes, primary asset, and the final lifecycle status.
 *   - scheduled run that only prepared the asset  -> "ready" (gate stops here)
 *   - instant run after publish                    -> "published" / "failed"
 */
export const persistNode = defineNode("persist", async (state) => {
  const primary = state.processedAsset ?? state.rawAsset;
  const variants = state.variants ?? [];

  // Attach variants to the asset (if it was persisted with an id).
  if (primary?.assetId && variants.length) {
    await AssetModel.updateOne(
      { _id: new Types.ObjectId(primary.assetId) },
      {
        $set: {
          variants: variants.map((v) => ({
            _id: new Types.ObjectId(v.variantId),
            platform: v.platform,
            aspectRatio: v.aspectRatio,
            cloudinaryUrl: v.cloudinaryUrl,
            s3Key: v.s3Key,
            width: v.width,
            height: v.height,
          })),
        },
      },
    );
  }

  const published = state.published ?? [];
  const wasPublishStep = published.length > 0;

  const targets = state.targets.map((t) => {
    const variant = variants.find((v) => v.platform === t.platform) ?? variants[0];
    const outcome = published.find(
      (p) => p.platform === t.platform && p.accountId === t.accountId,
    );
    return {
      platform: t.platform,
      accountId: new Types.ObjectId(t.accountId),
      assetVariantId: variant ? new Types.ObjectId(variant.variantId) : undefined,
      status: outcome ? outcome.status : ("pending" as const),
      externalPostId: outcome?.externalPostId,
      permalink: outcome?.permalink,
      error: outcome?.error,
    };
  });

  let status: string;
  if (!wasPublishStep) {
    status = "ready"; // scheduled: asset prepared, awaiting its run time
  } else {
    const anyPublished = published.some((p) => p.status === "published");
    const allFailed = published.every((p) => p.status === "failed");
    status = allFailed ? "failed" : anyPublished ? "published" : "ready";
  }

  await PostModel.updateOne(
    { _id: new Types.ObjectId(state.postId) },
    {
      $set: {
        status,
        targets,
        caption: state.caption ?? { text: "", hashtags: [], generated: false },
        ...(primary?.assetId
          ? { primaryAssetId: new Types.ObjectId(primary.assetId) }
          : {}),
        ...(wasPublishStep ? { "schedule.publishedAt": new Date() } : {}),
      },
    },
  );

  return { status: status === "failed" ? "failed" : wasPublishStep ? "published" : "ready" };
});
