import { Queue } from "bullmq";
import { connection, POST_QUEUE_NAME } from "./connection.js";

export interface ProcessPostJobData {
  postId: string;
  jobId: string;
  workspaceId: string;
}

/**
 * The single queue both entrypoints (web UI + external REST API) feed. Instant
 * posts enqueue with no delay; scheduled posts enqueue with `delay` computed
 * from runAt — BullMQ's delayed-job support IS the scheduling engine.
 */
export const postQueue = new Queue<ProcessPostJobData, unknown, string>(
  POST_QUEUE_NAME,
  {
    connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: false, // keep failures for the DLQ / inspection
    },
  },
);

export async function enqueuePost(data: ProcessPostJobData): Promise<string> {
  const job = await postQueue.add("process_post", data, {
    jobId: data.jobId, // idempotent: same job id won't double-enqueue
  });
  return job.id ?? data.jobId;
}

/**
 * Enqueues a "retry_publish_post" job that re-attempts publishing to all platforms
 * for a post that previously failed at the publish step. The post already has
 * generated content (asset variants + caption) so only the publish step reruns.
 */
export async function enqueueRetryPublish(data: ProcessPostJobData): Promise<string> {
  const job = await postQueue.add("retry_publish_post", data, {
    jobId: `retry_publish_${data.postId}_${Date.now()}`,
  });
  return job.id ?? data.postId;
}

/**
 * Enqueues a delayed "publish_scheduled_post" job that fires at runAt.
 * The worker's publish handler reads the post, calls the social platform publishers,
 * and transitions the post from "ready" → "published".
 * Job ID is deterministic so re-approving doesn't double-enqueue.
 */
export async function enqueueScheduledPublish(
  data: ProcessPostJobData,
  runAt: Date,
): Promise<string> {
  const delay = Math.max(0, runAt.getTime() - Date.now());
  const job = await postQueue.add("publish_scheduled_post", data, {
    delay,
    jobId: scheduledPublishJobId(data.postId),
  });
  return job.id ?? data.postId;
}

/** Deterministic id — see enqueueScheduledPublish / removeScheduledPublish. */
export function scheduledPublishJobId(postId: string): string {
  return `scheduled_publish_${postId}`;
}

/**
 * Drops a pending scheduled-publish job. Used when a post is cancelled.
 *
 * The worker also refuses to publish anything that isn't `ready`, so this isn't
 * the only thing standing between a cancelled post and a live publish — but
 * leaving a delayed job in Redis pointing at a cancelled post is a trap: it
 * fires, logs a warning, and burns a worker slot for nothing. Removing it keeps
 * the queue an honest picture of what's actually going to happen.
 *
 * Returns false when there was no such job (already fired, or the post was
 * never scheduled) — that's a normal outcome, not an error.
 */
export async function removeScheduledPublish(postId: string): Promise<boolean> {
  const job = await postQueue.getJob(scheduledPublishJobId(postId));
  if (!job) return false;
  // A job already running can't be removed; BullMQ throws rather than racing.
  try {
    await job.remove();
    return true;
  } catch {
    return false;
  }
}
