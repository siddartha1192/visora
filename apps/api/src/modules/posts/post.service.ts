import type { CreatePostInput, PostDTO, UserRole } from "@visora/shared";
import { isCancellable } from "@visora/shared";
import { Types } from "mongoose";
import { AgentLogModel, JobModel, PostModel } from "../../db/models/index.js";
import { NotFoundError, BadRequestError } from "../../lib/errors.js";
import {
  enqueuePost,
  enqueueRetryPublish,
  enqueueScheduledPublish,
  removeScheduledPublish,
} from "../../queue/post-queue.js";
import { resumePostGraph } from "../../orchestration/runner.js";
import { toPostDTO } from "./post.serializer.js";

/**
 * Creates a Post draft from any of the 5 workflow inputs and enqueues a Job.
 * This is the shared core both the web BFF and the external REST API call —
 * one pipeline, two entrypoints. Returns immediately (202-style); the worker
 * does the heavy lifting.
 */
export async function createPost(args: {
  workspaceId: string;
  authorId: string;
  input: CreatePostInput;
}): Promise<PostDTO> {
  const { workspaceId, authorId, input } = args;

  const post = await PostModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    authorId: new Types.ObjectId(authorId),
    workflow: input.workflow,
    status: "queued",
    input: {
      brief: "brief" in input ? (input as { brief: string }).brief : undefined,
      prompt: "prompt" in input ? input.prompt : undefined,
      instructions: "instructions" in input ? input.instructions : undefined,
      sourceUrl: "sourceUrl" in input ? input.sourceUrl : undefined,
      uploadedAssetId:
        "uploadedAssetId" in input
          ? new Types.ObjectId(input.uploadedAssetId)
          : undefined,
      context: "context" in input ? input.context : undefined,
      stockSource: "stockSource" in input ? input.stockSource : undefined,
      enhanceAfterStock: "enhanceAfterStock" in input ? input.enhanceAfterStock : undefined,
      enhanceInstructions: "enhanceInstructions" in input ? input.enhanceInstructions : undefined,
    },
    caption: {
      text: input.caption?.text ?? "",
      hashtags: input.caption?.hashtags ?? [],
      generated: input.caption?.generate ?? false,
    },
    targets: input.targets.map((t) => ({
      platform: t.platform,
      accountId: t.accountId,
      status: "pending",
    })),
    schedule: {
      mode: input.schedule.mode,
      runAt: input.schedule.runAt ? new Date(input.schedule.runAt) : undefined,
      timezone: input.schedule.timezone,
    },
  });

  const job = await JobModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    postId: post._id,
    state: "pending",
  });

  // Content generation always starts immediately — the schedule.runAt is when
  // to publish to social platforms after the user approves, not when to start the job.
  await enqueuePost({
    postId: post._id.toString(),
    jobId: job._id.toString(),
    workspaceId,
  });

  post.jobId = job._id;
  post.status = "queued";
  await post.save();

  return toPostDTO(post);
}

export async function listPosts(
  workspaceId: string,
  page = 1,
  pageSize = 20,
): Promise<{ items: PostDTO[]; total: number; page: number; pageSize: number }> {
  const filter = { workspaceId: new Types.ObjectId(workspaceId) };
  const [docs, total] = await Promise.all([
    PostModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    PostModel.countDocuments(filter),
  ]);
  return { items: docs.map(toPostDTO), total, page, pageSize };
}

export async function getPost(
  workspaceId: string,
  postId: string,
): Promise<PostDTO> {
  const post = await PostModel.findOne({
    _id: new Types.ObjectId(postId),
    workspaceId: new Types.ObjectId(workspaceId),
  });
  if (!post) throw new NotFoundError("Post");
  return toPostDTO(post);
}

export async function approvePost(
  workspaceId: string,
  postId: string,
  opts: { scheduledAt?: string; scheduleMode?: "instant" | "scheduled" } = {},
): Promise<PostDTO> {
  const post = await PostModel.findOne({
    _id: new Types.ObjectId(postId),
    workspaceId: new Types.ObjectId(workspaceId),
  });
  if (!post) throw new NotFoundError("Post");
  if (post.status !== "pending_review") {
    throw new BadRequestError(`Post is not pending review (status: ${post.status})`);
  }
  await resumePostGraph(post, { approved: true, ...opts });

  // After graph completes, if the post landed in "ready" with a schedule, enqueue a
  // BullMQ job that publishes to the platforms at runAt. If runAt has already passed
  // (e.g. approval happened late), enqueueScheduledPublish clamps the delay to 0 so
  // it fires immediately instead of never firing at all.
  const updated = await PostModel.findById(post._id);
  if (
    updated?.status === "ready" &&
    updated.schedule?.mode === "scheduled" &&
    updated.schedule?.runAt
  ) {
    await enqueueScheduledPublish(
      {
        postId: post._id.toString(),
        jobId: post.jobId?.toString() ?? post._id.toString(),
        workspaceId: post.workspaceId.toString(),
      },
      updated.schedule.runAt,
    );
  }

  return toPostDTO(updated!);
}

export async function rejectPost(workspaceId: string, postId: string): Promise<PostDTO> {
  const post = await PostModel.findOne({
    _id: new Types.ObjectId(postId),
    workspaceId: new Types.ObjectId(workspaceId),
  });
  if (!post) throw new NotFoundError("Post");
  if (post.status !== "pending_review") {
    throw new BadRequestError(`Post is not pending review (status: ${post.status})`);
  }
  await resumePostGraph(post, { approved: false });
  const updated = await PostModel.findById(post._id);
  return toPostDTO(updated!);
}

/**
 * Retries a failed post in one of two modes:
 *  - "from_failed": re-runs only the publish step using existing generated content
 *  - "full": resets the post and reruns the full pipeline from scratch
 */
export async function retryPost(
  workspaceId: string,
  postId: string,
  mode: "from_failed" | "full",
): Promise<PostDTO> {
  const post = await PostModel.findOne({
    _id: new Types.ObjectId(postId),
    workspaceId: new Types.ObjectId(workspaceId),
  });
  if (!post) throw new NotFoundError("Post");
  if (post.status !== "failed") {
    throw new BadRequestError(`Post cannot be retried (status: ${post.status})`);
  }

  if (mode === "from_failed") {
    if (!post.primaryAssetId) {
      throw new BadRequestError("Post has no generated content — use full rerun instead");
    }
    // Mark as publishing so the UI shows progress and double-submits are blocked
    post.status = "publishing";
    post.lastError = undefined;
    await post.save();

    await enqueueRetryPublish({
      postId: post._id.toString(),
      jobId: post.jobId?.toString() ?? post._id.toString(),
      workspaceId,
    });
  } else {
    // Full rerun — create a new job and re-run the entire pipeline
    const job = await JobModel.create({
      workspaceId: new Types.ObjectId(workspaceId),
      postId: post._id,
      state: "pending",
    });

    post.status = "queued";
    post.lastError = undefined;
    post.jobId = job._id;
    await post.save();

    await enqueuePost({
      postId: post._id.toString(),
      jobId: job._id.toString(),
      workspaceId,
    });
  }

  return toPostDTO(post);
}

/** Why a given status can't be cancelled — surfaced verbatim to the caller. */
function uncancellableReason(status: string): string {
  switch (status) {
    case "publishing":
      return "This post is being published right now — the platform calls have already gone out, so it can no longer be stopped.";
    case "published":
      return "This post has already been published. Cancelling won't remove it from the platforms — delete it there instead.";
    case "cancelled":
      return "This post is already cancelled.";
    case "rejected":
      return "This post was rejected at review and was never going to publish.";
    case "failed":
      return "This post already failed and won't publish. Retry it or delete it instead.";
    default:
      return `A post with status "${status}" cannot be cancelled.`;
  }
}

/**
 * Stops a post before it reaches the platforms and marks it `cancelled`.
 *
 * Ordering matters: the delayed publish job is dropped *before* the status
 * write, so there is no window where the queue still holds a live trigger for
 * a post the DB already considers cancelled. The worker's own `status ===
 * "ready"` guard covers the reverse ordering, so a failure between the two
 * steps is safe in either direction.
 *
 * `workspaceId` is REQUIRED and always applied. It was previously nullable so
 * admin routes could reach across workspaces, which meant a single `null`
 * collapsed this to an unscoped `findOne({_id})`. Admin callers now resolve the
 * post's real workspace (after an authorization check) and pass it in, so there
 * is no bypass path left to misuse.
 */
export async function cancelPost(args: {
  workspaceId: string;
  postId: string;
  /** `userId` is absent for API-key callers, which have no user behind them. */
  actor: { userId?: string; role: UserRole };
}): Promise<PostDTO> {
  const { workspaceId, postId, actor } = args;

  const post = await PostModel.findOne({
    _id: new Types.ObjectId(postId),
    workspaceId: new Types.ObjectId(workspaceId),
  });
  if (!post) throw new NotFoundError("Post");

  // Previously this silently returned the untouched post for already-published
  // work, so the caller got a 200 and reasonably assumed the cancel took.
  if (!isCancellable(post.status)) {
    throw new BadRequestError(uncancellableReason(post.status));
  }

  await removeScheduledPublish(post._id.toString());

  post.status = "cancelled";
  post.cancelledAt = new Date();
  if (actor.userId && Types.ObjectId.isValid(actor.userId)) {
    post.cancelledBy = {
      userId: new Types.ObjectId(actor.userId),
      role: actor.role,
    };
  }
  await post.save();

  // Mirrored into the execution log so a cancellation appears in the same
  // drawer as the rest of the pipeline's history rather than being invisible.
  await AgentLogModel.create({
    workspaceId: post.workspaceId,
    postId: post._id,
    jobId: post.jobId ?? undefined,
    threadId: post.jobId?.toString() ?? post._id.toString(),
    node: "pipeline",
    sequence: 20000,
    status: "skipped",
    message:
      actor.role === "user"
        ? "Cancelled by the author — publication stopped"
        : `Cancelled by ${actor.role} — publication stopped`,
    data: { cancelledBy: actor.userId ?? "api_key", role: actor.role },
  }).catch(() => {
    // An audit-log write must never be what fails a cancellation.
  });

  return toPostDTO(post);
}
