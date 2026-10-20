import { Worker, type Job } from "bullmq";
import { Types } from "mongoose";
import type { Platform } from "@visora/shared";
import { AgentLogModel, AssetModel, JobModel, PostModel, WorkspaceModel } from "../db/models/index.js";
import { logger } from "../lib/logger.js";
import { appLog } from "../lib/logging/index.js";
import { runPostGraph, getServices } from "../orchestration/runner.js";
import { resolvePublisher } from "../modules/workspace/publisher-resolver.js";
import { connection, POST_QUEUE_NAME } from "./connection.js";
import { enqueueScheduledPublish, type ProcessPostJobData } from "./post-queue.js";

/**
 * Core publish logic shared by the scheduled publish job and the retry-publish job.
 * Reads asset variants from DB and calls the platform publishers for each target.
 * Returns the final post status.
 */
async function runPublishStep(
  postId: string,
  context: string,
): Promise<void> {
  const post = await PostModel.findById(new Types.ObjectId(postId));
  if (!post) throw new Error(`${context}: post ${postId} not found`);

  const services = await getServices();

  const asset = post.primaryAssetId
    ? await AssetModel.findById(post.primaryAssetId)
    : null;

  if (!asset) throw new Error(`${context}: no asset for post ${postId}`);

  const workspace = await WorkspaceModel.findById(post.workspaceId, "socialAccounts").lean();

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
      const publisher = workspace
        ? resolvePublisher(workspace, target.platform as Platform, services.publishers)
        : services.publishers[target.platform as Platform];

      if (!imageUrl) {
        return {
          platform: target.platform,
          accountId: target.accountId,
          status: "failed" as const,
          error: "no optimized variant available",
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

  logger.info({ postId, finalStatus }, `${context} completed`);
}

/**
 * Publishes a "ready" post directly to every target social platform.
 * Called by the "publish_scheduled_post" delayed job.
 */
async function publishScheduledPost(postId: string): Promise<void> {
  const post = await PostModel.findById(new Types.ObjectId(postId));
  if (!post) throw new Error(`scheduled publish: post ${postId} not found`);
  if (post.status !== "ready") {
    logger.warn({ postId }, "scheduled publish: post not in ready state, skipping");
    return;
  }
  await runPublishStep(postId, "scheduled publish");
}

/**
 * Re-attempts publishing for a post that previously failed at the publish step.
 * Emits AgentLog entries so the retry is visible in the execution log drawer as a
 * continuation after the original run's entries (sequences start at 10000).
 */
async function retryPublishPost(postId: string, workspaceId: string, jobId: string): Promise<void> {
  const post = await PostModel.findById(new Types.ObjectId(postId));
  if (!post) throw new Error(`retry publish: post ${postId} not found`);

  const base = {
    workspaceId: Types.ObjectId.isValid(workspaceId) ? new Types.ObjectId(workspaceId) : undefined,
    postId: new Types.ObjectId(postId),
    jobId: Types.ObjectId.isValid(jobId) ? new Types.ObjectId(jobId) : undefined,
    threadId: jobId,
  };

  const writeLog = (
    node: string,
    seq: number,
    status: "started" | "succeeded" | "failed",
    message: string,
    data?: Record<string, unknown>,
    err?: Error,
  ) =>
    AgentLogModel.create({
      ...base,
      node,
      sequence: seq,
      status,
      message,
      ...(data ? { data } : {}),
      ...(err ? { error: { message: err.message, stack: err.stack } } : {}),
    }).catch((e) => logger.error({ e, node }, "failed writing retry log"));

  await writeLog("pipeline", 10000, "started", "Pipeline retry — publishing from previous content");

  const startedAt = Date.now();
  await writeLog("publish", 10001, "started", "publish: started");

  try {
    const services = await getServices();
    const asset = post.primaryAssetId ? await AssetModel.findById(post.primaryAssetId) : null;
    if (!asset) throw new Error("no asset for post — cannot retry publish");
    const workspace = await WorkspaceModel.findById(post.workspaceId, "socialAccounts").lean();

    const captionText = post.caption?.text ?? "";
    const hashtags    = post.caption?.hashtags ?? [];
    const fullCaption = [
      captionText,
      hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" "),
    ].filter(Boolean).join("\n\n");

    const results = await Promise.all(
      post.targets.map(async (target) => {
        const variant =
          asset.variants.find((v) => v.platform === target.platform) ?? asset.variants[0];
        const imageUrl = variant?.cloudinaryUrl;
        const publisher = workspace
          ? resolvePublisher(workspace, target.platform as Platform, services.publishers)
          : services.publishers[target.platform as Platform];

        if (!imageUrl) {
          return { platform: target.platform, accountId: target.accountId, status: "failed" as const, error: "no optimized variant available" };
        }
        try {
          const res = await publisher.publish({
            platform: target.platform as Platform,
            accountId: target.accountId.toString(),
            imageUrl,
            caption: fullCaption,
          });
          return { platform: target.platform, accountId: target.accountId, status: "published" as const, externalPostId: res.externalPostId, permalink: res.permalink };
        } catch (err) {
          return { platform: target.platform, accountId: target.accountId, status: "failed" as const, error: (err as Error).message };
        }
      }),
    );

    const allFailed    = results.every((r) => r.status === "failed");
    const anyPublished = results.some((r) => r.status === "published");
    const finalStatus  = allFailed ? "failed" : anyPublished ? "published" : "ready";
    const failed       = results.filter((r) => r.status === "failed");
    const publishedCount = results.filter((r) => r.status === "published").length;

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
      { $set: { status: finalStatus, targets: updatedTargets, "schedule.publishedAt": new Date() } },
    );

    const failureSummary = failed.map((r) => `${r.platform}: ${r.error ?? "unknown error"}`).join(" | ");
    const publishMessage = failed.length > 0
      ? `Published to ${publishedCount}/${results.length} platform(s) — ${failureSummary}`
      : `Published to ${publishedCount}/${results.length} platform(s)`;

    const durationMs = Date.now() - startedAt;
    await writeLog("publish", 10001, "succeeded", publishMessage, {
      publishedCount, failedCount: failed.length,
      platforms: results.map((r) => ({ platform: r.platform, status: r.status, error: "error" in r ? r.error : undefined })),
    });
    await writeLog("pipeline", 10000, allFailed ? "failed" : "succeeded",
      `Pipeline retry completed — ${finalStatus}`, { finalStatus, durationMs });

    logger.info({ postId, finalStatus }, "retry publish completed");
  } catch (err) {
    const e = err as Error;
    const durationMs = Date.now() - startedAt;
    await writeLog("publish", 10001, "failed", `publish: failed — ${e.message}`, undefined, e);
    await writeLog("pipeline", 10000, "failed", `Pipeline retry failed — ${e.message}`, { durationMs }, e);
    await PostModel.updateOne({ _id: post._id }, { $set: { status: "failed", lastError: e.message } });
    logger.error({ postId, err: e.message }, "retry publish failed");
    throw err;
  }
}

/**
 * MongoDB is the durable source of truth for `schedule.runAt`; the BullMQ delayed
 * job in Redis is only the trigger. If Redis loses its queue (volume wiped, job
 * never got enqueued, container was down when a job should have fired, etc.) a
 * "ready" scheduled post would otherwise sit forever with nothing to publish it.
 *
 * Re-enqueueing here is safe to call any time: the job id is deterministic
 * (`scheduled_publish_${postId}`) so it can't double-enqueue, and
 * `enqueueScheduledPublish` clamps an already-past `runAt` to a 0ms delay — so
 * anything overdue publishes immediately instead of being silently dropped.
 */
export async function reconcileScheduledPosts(): Promise<void> {
  const due = await PostModel.find({
    status: "ready",
    "schedule.mode": "scheduled",
    "schedule.runAt": { $ne: null },
  });

  for (const post of due) {
    if (!post.schedule?.runAt) continue;
    await enqueueScheduledPublish(
      {
        postId: post._id.toString(),
        jobId: post.jobId?.toString() ?? post._id.toString(),
        workspaceId: post.workspaceId.toString(),
      },
      post.schedule.runAt,
    );
  }

  if (due.length > 0) {
    logger.info({ count: due.length }, "reconciled scheduled posts against the queue");
  }
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

      // ── Retry publish (re-attempt failed platform calls) ──────────────────
      if (job.name === "retry_publish_post") {
        logger.info({ postId }, "worker: retrying publish");
        await retryPublishPost(postId, workspaceId, jobId);
        return { status: "done" };
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
    } else if (
      job.name === "publish_scheduled_post" ||
      job.name === "retry_publish_post"
    ) {
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
