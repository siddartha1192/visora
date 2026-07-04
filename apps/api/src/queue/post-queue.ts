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
    jobId: `scheduled_publish_${data.postId}`,
  });
  return job.id ?? data.postId;
}
