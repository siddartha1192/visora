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

export async function enqueuePost(
  data: ProcessPostJobData,
  opts: { runAt?: Date } = {},
): Promise<string> {
  const delay =
    opts.runAt && opts.runAt.getTime() > Date.now()
      ? opts.runAt.getTime() - Date.now()
      : 0;
  const job = await postQueue.add("process_post", data, {
    delay,
    jobId: data.jobId, // idempotent: same job id won't double-enqueue
  });
  return job.id ?? data.jobId;
}
