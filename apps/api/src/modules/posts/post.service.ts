import type { CreatePostInput, PostDTO } from "@visora/shared";
import { Types } from "mongoose";
import { JobModel, PostModel } from "../../db/models/index.js";
import { NotFoundError, BadRequestError } from "../../lib/errors.js";
import { enqueuePost } from "../../queue/post-queue.js";
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
      accountId: new Types.ObjectId(t.accountId),
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
    runAt: post.schedule?.runAt,
  });

  await enqueuePost(
    {
      postId: post._id.toString(),
      jobId: job._id.toString(),
      workspaceId,
    },
    { runAt: post.schedule?.runAt ?? undefined },
  );

  post.jobId = job._id;
  post.status = input.schedule.mode === "scheduled" ? "scheduled" : "queued";
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

export async function approvePost(workspaceId: string, postId: string): Promise<PostDTO> {
  const post = await PostModel.findOne({
    _id: new Types.ObjectId(postId),
    workspaceId: new Types.ObjectId(workspaceId),
  });
  if (!post) throw new NotFoundError("Post");
  if (post.status !== "pending_review") {
    throw new BadRequestError(`Post is not pending review (status: ${post.status})`);
  }
  await resumePostGraph(post, { approved: true });
  const updated = await PostModel.findById(post._id);
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

export async function cancelPost(
  workspaceId: string,
  postId: string,
): Promise<PostDTO> {
  const post = await PostModel.findOne({
    _id: new Types.ObjectId(postId),
    workspaceId: new Types.ObjectId(workspaceId),
  });
  if (!post) throw new NotFoundError("Post");
  if (["published", "publishing"].includes(post.status)) {
    return toPostDTO(post); // too late to cancel
  }
  post.status = "cancelled";
  await post.save();
  return toPostDTO(post);
}
