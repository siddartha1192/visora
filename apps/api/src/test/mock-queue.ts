import { vi } from "vitest";

/**
 * `POST /v1/posts` enqueues onto BullMQ/Redis, which isn't available in the
 * test environment (no Docker, no local Redis). Redis is not what these tests
 * verify — tenant-scoped authorization is — so the queue module is replaced
 * with a no-op that resolves immediately, matching what a healthy enqueue call
 * returns. Real queue behaviour is out of scope here.
 *
 * Call `vi.mock("../../queue/post-queue.js", () => import("../../test/mock-queue.js"))`
 * (path relative to the importing test file) before any import that pulls in
 * post.service.ts.
 */
export const enqueuePost = vi.fn(async () => "test-job-id");
export const enqueueRetryPublish = vi.fn(async () => "test-job-id");
export const enqueueScheduledPublish = vi.fn(async () => "test-job-id");
export const removeScheduledPublish = vi.fn(async () => true);
export const scheduledPublishJobId = (postId: string) => `scheduled_publish_${postId}`;
