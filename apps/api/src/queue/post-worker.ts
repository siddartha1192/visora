import { Worker, type Job } from "bullmq";
import { Types } from "mongoose";
import { JobModel, PostModel } from "../db/models/index.js";
import { logger } from "../lib/logger.js";
import { appLog } from "../lib/logging/index.js";
import { runPostGraph } from "../orchestration/runner.js";
import { connection, POST_QUEUE_NAME } from "./connection.js";
import type { ProcessPostJobData } from "./post-queue.js";

/**
 * The worker: dequeues a process_post job, loads the Post, runs the LangGraph
 * pipeline, and reconciles the Job record. A throw bubbles to BullMQ which
 * retries with backoff; after final failure the post + job are marked failed
 * and the job lands in the (kept) failed set for inspection.
 */
export function startPostWorker() {
  const worker = new Worker<ProcessPostJobData>(
    POST_QUEUE_NAME,
    async (job: Job<ProcessPostJobData>) => {
      const { postId, jobId, workspaceId } = job.data;

      await JobModel.updateOne(
        { _id: new Types.ObjectId(jobId) },
        { $set: { state: "active" }, $inc: { attempts: 1 } },
      );

      const post = await PostModel.findById(new Types.ObjectId(postId));
      if (!post) throw new Error(`worker: post ${postId} not found`);

      // Build a job-scoped logger with workspace + author context.
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
    logger.info({ jobId: job.id }, "job completed"),
  );

  worker.on("failed", async (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "job failed");

    if (job) {
      appLog.child({
        jobId: job.data.jobId,
        postId: job.data.postId,
        workspaceId: job.data.workspaceId,
        attempt: job.attemptsMade,
      }).error("job failed", { err: err.message });
    }

    if (!job) return;
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
  });

  logger.info("post worker started");
  appLog.info("post worker started");
  return worker;
}
