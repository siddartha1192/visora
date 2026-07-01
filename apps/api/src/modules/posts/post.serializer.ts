import type { PostDTO } from "@visora/shared";
import type { PostDoc } from "../../db/models/index.js";

/** Maps a Mongoose Post document to the wire DTO shared with the frontend. */
export function toPostDTO(post: PostDoc): PostDTO {
  return {
    id: post._id.toString(),
    workspaceId: post.workspaceId.toString(),
    authorId: post.authorId.toString(),
    workflow: post.workflow,
    status: post.status,
    input: {
      prompt: post.input?.prompt ?? undefined,
      instructions: post.input?.instructions ?? undefined,
      sourceUrl: post.input?.sourceUrl ?? undefined,
      uploadedAssetId: post.input?.uploadedAssetId?.toString(),
      context: post.input?.context ?? undefined,
    },
    caption: {
      text: post.caption?.text ?? "",
      hashtags: post.caption?.hashtags ?? [],
      generated: post.caption?.generated ?? false,
    },
    targets: post.targets.map((t) => ({
      platform: t.platform,
      accountId: t.accountId.toString(),
      assetVariantId: t.assetVariantId?.toString(),
      status: t.status,
      externalPostId: t.externalPostId ?? undefined,
      permalink: t.permalink ?? undefined,
      error: t.error ?? undefined,
    })),
    primaryAssetId: post.primaryAssetId?.toString(),
    schedule: {
      mode: post.schedule?.mode ?? "instant",
      runAt: post.schedule?.runAt?.toISOString(),
      timezone: post.schedule?.timezone ?? "UTC",
      publishedAt: post.schedule?.publishedAt?.toISOString(),
    },
    jobId: post.jobId?.toString(),
    lastError: post.lastError ?? undefined,
    createdAt: (post as unknown as { createdAt: Date }).createdAt.toISOString(),
    updatedAt: (post as unknown as { updatedAt: Date }).updatedAt.toISOString(),
  };
}
