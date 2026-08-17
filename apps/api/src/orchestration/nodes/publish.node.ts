/**
 * FILE: publish.node.ts
 * Step 5 of the pipeline — posts the content to every target social platform.
 * Runs all platforms in parallel. If one platform fails, the others still succeed —
 * failures are captured per-platform so the whole post isn't marked failed because of one network.
 * Only runs on instant posts; scheduled posts skip straight to persist.
 */
import { defineNode } from "../context.js";
import type { NodeReturn } from "../context.js";
import { withRetry } from "../../lib/retry.js";
import { WorkspaceModel } from "../../db/models/index.js";
import { resolvePublisher } from "../../modules/workspace/publisher-resolver.js";

/**
 * Fan-out publish. For each target we pick the platform-matched variant and
 * call the per-platform Publisher port. Failures are captured per-target (not
 * thrown) so one platform failing does not block the others — the post ends up
 * "published" (possibly partial) rather than wholesale "failed".
 */
export const publishNode = defineNode("publish", async (state, ctx) => {
  const variants = state.variants ?? [];
  const caption = state.caption?.text ?? "";
  const hashtags = state.caption?.hashtags ?? [];
  const fullCaption = [caption, hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")]
    .filter(Boolean)
    .join("\n\n");

  // Workspaces without a connected social account fall back to the platform
  // default publisher inside resolvePublisher — see its docstring.
  const workspace = await WorkspaceModel.findById(state.workspaceId, "socialAccounts").lean();

  const results = await Promise.all(
    state.targets.map(async (target) => {
      const variant =
        variants.find((v) => v.platform === target.platform) ?? variants[0];
      if (!variant) {
        return {
          platform: target.platform,
          accountId: target.accountId,
          status: "failed" as const,
          error: "no variant produced for target",
        };
      }
      const publisher = workspace
        ? resolvePublisher(workspace, target.platform, ctx.services.publishers)
        : ctx.services.publishers[target.platform];
      try {
        const res = await withRetry(
          () => publisher.publish({
            platform: target.platform,
            accountId: target.accountId,
            imageUrl: variant.cloudinaryUrl,
            caption: fullCaption,
          }),
          { label: `publisher.${target.platform}`, retries: 2, baseDelayMs: 1500, maxDelayMs: 12000 },
        );
        return {
          platform: target.platform,
          accountId: target.accountId,
          externalPostId: res.externalPostId,
          permalink: res.permalink,
          status: "published" as const,
        };
      } catch (err) {
        return {
          platform: target.platform,
          accountId: target.accountId,
          status: "failed" as const,
          error: (err as Error).message,
        };
      }
    }),
  );

  const publishedCount = results.filter((r) => r.status === "published").length;
  const failed = results.filter((r) => r.status === "failed");

  const failureSummary = failed
    .map((r) => `${r.platform}: ${r.error ?? "unknown error"}`)
    .join(" | ");

  const logMessage =
    failed.length > 0
      ? `Published to ${publishedCount}/${results.length} platform(s) — ${failureSummary}`
      : `Published to ${publishedCount}/${results.length} platform(s)`;

  return {
    published: results,
    usage: [{ node: "publish", provider: "publishers" }],
    logMessage,
    logData: {
      publishedCount,
      failedCount: failed.length,
      platforms: results.map((r) => ({ platform: r.platform, status: r.status, error: r.error })),
    },
  } satisfies NodeReturn;
});
