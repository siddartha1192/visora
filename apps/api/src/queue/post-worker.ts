import { Worker, type Job } from "bullmq";
import { Types } from "mongoose";
import type { Platform } from "@visora/shared";
import { AssetModel, JobModel, PostModel } from "../db/models/index.js";
import { logger } from "../lib/logger.js";
import { appLog } from "../lib/logging/index.js";
import { runPostGraph, getServices } from "../orchestration/runner.js";
import { connection, POST_QUEUE_NAME } from "./connection.js";
import type { ProcessPostJobData } from "./post-queue.js";

/**
 * Publishes a "ready" post directly to every target social platform.
 * Called by the "publish_scheduled_post" delayed job — the full graph has already
 * run (content generated, approved, persisted as "ready"). This handler picks up
 * at the platform-publish step only.
 */
async function publishScheduledPost(postId: string): Promise<void> {
  const post = await PostModel.findById(new Types.ObjectId(postId));
  if (!post) throw new Error(`scheduled publish: post ${postId} not found`);
  if (post.status !== "ready") {
    logger.warn({ postId }, "scheduled publish: post not in ready state, skipping");
    return;
  }

  const services = await getServices();

  const asset = post.primaryAssetId
    ? await AssetModel.findById(post.primaryAssetId)
    : null;

  if (!asset) throw new Error(`scheduled publish: no asset for post ${postId}`);

  const captionText = post.caption?.text ?? "";
  const hashtags    = post.caption?.hashtags ?? [];
  const fullCaption = [
    captionText,
    hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");

  const results = await Promise.all(
    post.targets.map(async (target) => {
      const variant =
        asset.variants.find((v) => v.platform === target.platform) ??
        asset.variants[0];
      const imageUrl = variant?.cloudinaryUrl;
      const publisher = services.publishers[target.platform as Platform];

      if (!imageUrl) {
        return {
          platform: target.platform,
          accountId: target.accountId,
          status: "failed" as const,
          error: "no optimized variant available for scheduled publish",
        };
      }

      try {
        const res = await publisher.publish({
          platform: target.platform as Platform,
          accountId: target.accountId.toString(),
          imageUrl,
          caption: fullCaption,
        });
        return {
          platform: target.platform,
          accountId: target.accountId,
          status: "published" as const,
          externalPostId: res.externalPostId,
          permalink: res.permalink,
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

  const allFailed    = results.every((r) => r.status === "failed");
  const anyPublished = results.some((r) => r.status === "published");
  const finalStatus  = allFailed ? "failed" : anyPublished ? "published" : "ready";

  const updatedTargets = post.targets.map((t) => {
    const result = results.find((r) => r.platform === t.platform);
    return {
      ...t,
      status: result?.status ?? t.status,
      externalPostId: result && "externalPostId" in result ? result.externalPostId : t.externalPostId,
      permalink:      result && "permalink"      in result ? result.permalink      : t.permalink,
      error:          result && "error"          in result ? result.error          : t.error,
    };
  });

  await PostModel.updateOne(
    { _id: post._id },
    {
      $set: {
        status: finalStatus,
        targets: updatedTargets,
        "schedule.publishedAt": new Date(),
      },
    },
  );

  logger.info({ postId, finalStatus }, "scheduled publish completed");
}

/**
 * The worker: dequeues jobs from the post queue and dispatches by job name:
 *  - "process_post"            → run the full LangGraph pipeline
 *  - "publish_scheduled_post"  → publish a "ready" post at its scheduled time
 */
export function startPostWorker() {
  const worker = new Worker<ProcessPostJobData>(
    POST_QUEUE_NAME,
    async (job: Job<ProcessPostJobData>) => {
      const { postId, jobId, workspaceId } = job.data;

      // ── Scheduled publish (delayed second phase) ─────────────────────────
      if (job.name === "publish_scheduled_post") {
        logger.info({ postId }, "worker: publishing scheduled post");
        await publishScheduledPost(postId);
        return { status: "published" };
      }

      // ── Full pipeline (content generation + review + persist) ─────────────
      await JobModel.updateOne(
        { _id: new Types.ObjectId(jobId) },
        { $set: { state: "active" }, $inc: { attempts: 1 } },
      );

      const post = await PostModel.findById(new Types.ObjectId(postId));
      if (!post) throw new Error(`worker: post ${postId} not found`);

      const jobLog = appLog.child({
        jobId,
        postId,
        workspaceId,
        workflow: post.workflow,
        user: { id: post.authorId.toString() },
      });

      jobLog.info("job started");

      const result = await runPostGraph(post, jobId);

      await JobModel.updateOne(
        { _id: new Types.ObjectId(jobId) },
        { $set: { state: "completed" } },
      );

      jobLog.info("job completed", { status: result.status });
      return { status: result.status };
    },
    { connection, concurrency: 4 },
  );

  worker.on("completed", (job) =>
    logger.info({ jobId: job.id, name: job.name }, "job completed"),
  );

  worker.on("failed", async (job, err) => {
    logger.error({ jobId: job?.id, name: job?.name, err: err.message }, "job failed");

    if (job) {
      appLog.child({
        jobId: job.data.jobId,
        postId: job.data.postId,
        workspaceId: job.data.workspaceId,
        attempt: job.attemptsMade,
      }).error("job failed", { err: err.message });
    }

    if (!job) return;

    // Only update the Job record for the main pipeline job (not the publish-only job)
    if (job.name === "process_post") {
      const finalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
      await JobModel.updateOne(
        { _id: new Types.ObjectId(job.data.jobId) },
        { $set: { state: finalAttempt ? "failed" : "pending", lastError: err.message } },
      );
      if (finalAttempt) {
        await PostModel.updateOne(
          { _id: new Types.ObjectId(job.data.postId) },
          { $set: { status: "failed", lastError: err.message } },
        );
      }
    } else if (job.name === "publish_scheduled_post") {
      const finalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
      if (finalAttempt) {
        await PostModel.updateOne(
          { _id: new Types.ObjectId(job.data.postId) },
          { $set: { status: "failed", lastError: err.message } },
        );
      }
    }
  });

  logger.info("post worker started");
  appLog.info("post worker started");
  return worker;
}
