import { defineNode } from "../context.js";

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
      const publisher = ctx.services.publishers[target.platform];
      try {
        const res = await publisher.publish({
          platform: target.platform,
          accountId: target.accountId,
          imageUrl: variant.cloudinaryUrl,
          caption: fullCaption,
        });
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

  return {
    published: results,
    usage: [{ node: "publish", provider: "publishers" }],
  };
});
