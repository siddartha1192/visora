/**
 * FILE: runner.ts
 * The entry point called by the BullMQ background job worker to execute the pipeline.
 *
 * Responsibilities:
 *  - Compiles the graph once per process and reuses it for all subsequent runs (singleton)
 *  - Converts a PostDoc database document into the initial GraphState the pipeline expects
 *  - Injects the services container via `configurable` so nodes never import providers directly
 *  - Ties each run to a `thread_id` (= jobId) so the checkpointer can resume a crashed run
 *  - Emits pipeline-level AgentLog events (sequence 0 = start, N+1 = complete/fail)
 */
import { Command } from "@langchain/langgraph";
import { Types } from "mongoose";
import type { PostDoc } from "../db/models/index.js";
import { AgentLogModel } from "../db/models/index.js";
import { createContainer, type ServiceContainer } from "../config/container.js";
import { resolveNodeAdapters } from "./node-adapters.js";
import { logger } from "../lib/logger.js";
import { buildGraph, type CompiledGraph } from "./graph.js";
import type { GraphStateType } from "./state.js";

let compiled: CompiledGraph | null = null;
let services: ServiceContainer | null = null;

/** Compile the graph once per process and reuse it across runs. */
async function getGraph(): Promise<{ graph: CompiledGraph; services: ServiceContainer }> {
  if (!compiled || !services) {
    services = createContainer();
    compiled = await buildGraph(services);
  }
  return { graph: compiled, services };
}

/** Returns the cached service container without compiling the full graph. */
export async function getServices(): Promise<ServiceContainer> {
  return (await getGraph()).services;
}

/** Maps a persisted Post into the graph's initial channel state. */
function initialState(post: PostDoc, jobId: string): Partial<GraphStateType> {
  return {
    workspaceId: post.workspaceId.toString(),
    postId: post._id.toString(),
    jobId,
    threadId: jobId,
    workflow: post.workflow,
    input: {
      brief: (post.input as { brief?: string })?.brief ?? undefined,
      prompt: post.input?.prompt ?? undefined,
      instructions: post.input?.instructions ?? undefined,
      sourceUrl: post.input?.sourceUrl ?? undefined,
      uploadedAssetId: post.input?.uploadedAssetId?.toString(),
      context: post.input?.context ?? undefined,
      stockSource: (post.input as { stockSource?: "auto" | "pexels" | "unsplash" })?.stockSource ?? undefined,
      enhanceAfterStock: (post.input as { enhanceAfterStock?: boolean })?.enhanceAfterStock ?? undefined,
      enhanceInstructions: (post.input as { enhanceInstructions?: string })?.enhanceInstructions ?? undefined,
    },
    targets: post.targets.map((t) => ({
      platform: t.platform,
      accountId: t.accountId.toString(),
    })),
    captionRequest: {
      text: post.caption?.text || undefined,
      hashtags: post.caption?.hashtags ?? [],
      generate: post.caption?.generated ?? false,
    },
    scheduleMode: (post.schedule?.mode as "instant" | "scheduled" | "auto") ?? "instant",
    status: "running",
  };
}

/** Writes a pipeline-level AgentLog entry (node = "pipeline"). */
async function emitPipelineLog(
  base: {
    workspaceId: Types.ObjectId | undefined;
    postId: Types.ObjectId | undefined;
    jobId: Types.ObjectId | undefined;
    threadId: string;
  },
  status: "started" | "succeeded" | "failed",
  sequence: number,
  message: string,
  data?: Record<string, unknown>,
  err?: Error,
) {
  await AgentLogModel.create({
    ...base,
    node: "pipeline",
    sequence,
    status,
    message,
    ...(data ? { data } : {}),
    ...(err ? { error: { message: err.message, stack: err.stack } } : {}),
  }).catch((e) => logger.error({ e }, "failed writing pipeline log"));
}

/**
 * Executes the full graph for a post. Called by the BullMQ worker. The services
 * container is injected via `configurable` so nodes never import providers; the
 * thread_id ties the run to its checkpoint for resumability.
 */
export async function runPostGraph(post: PostDoc, jobId: string) {
  const { graph, services: svc } = await getGraph();
  const postId = post._id.toString();

  const base = {
    workspaceId: Types.ObjectId.isValid(post.workspaceId.toString())
      ? new Types.ObjectId(post.workspaceId.toString())
      : undefined,
    postId: new Types.ObjectId(postId),
    jobId: Types.ObjectId.isValid(jobId) ? new Types.ObjectId(jobId) : undefined,
    threadId: jobId,
  };

  logger.info({ postId, workflow: post.workflow, jobId }, "running post graph");

  // sequence 0 = pipeline start (before any node runs)
  await emitPipelineLog(base, "started", 0, `Pipeline started — ${post.workflow}`, {
    workflow: post.workflow,
    scheduleMode: post.schedule?.mode ?? "instant",
  });

  try {
    const nodeAdapters = await resolveNodeAdapters();
    const result = await graph.invoke(initialState(post, jobId), {
      configurable: { services: svc, nodeAdapters, thread_id: jobId },
      recursionLimit: 50,
    });

    const finalSeq = (result.seq ?? 0) + 1;
    await emitPipelineLog(base, "succeeded", finalSeq, `Pipeline completed — ${result.status}`, {
      finalStatus: result.status,
      nodeCount: result.seq ?? 0,
    });

    logger.info({ postId, status: result.status }, "post graph finished");
    return result;
  } catch (err) {
    const e = err as Error;
    await emitPipelineLog(base, "failed", 9999, `Pipeline failed — ${e.message}`, undefined, e);
    logger.error({ postId, err: e.message }, "post graph failed");
    throw err;
  }
}

/**
 * Resumes a graph that was paused at the review interrupt.
 * Called by the approve / reject API endpoints — not the worker.
 * The full decision is forwarded to the review node via interrupt() so it can
 * update the schedule (scheduledAt / scheduleMode) before routing downstream.
 */
export async function resumePostGraph(
  post: PostDoc,
  decision: {
    approved: boolean;
    scheduledAt?: string;
    scheduleMode?: "instant" | "scheduled";
  },
) {
  if (!post.jobId) throw new Error(`resumePostGraph: post ${post._id} has no jobId — cannot resume`);
  const { graph, services: svc } = await getGraph();
  const postId = post._id.toString();
  const threadId = post.jobId.toString();

  const base = {
    workspaceId: Types.ObjectId.isValid(post.workspaceId.toString())
      ? new Types.ObjectId(post.workspaceId.toString())
      : undefined,
    postId: new Types.ObjectId(postId),
    jobId: new Types.ObjectId(threadId),
    threadId,
  };

  logger.info({ postId, approved: decision.approved }, "resuming post graph after review");

  await emitPipelineLog(base, "started", 500, `Pipeline resumed — ${decision.approved ? "approved" : "rejected"}`, {
    approved: decision.approved,
    scheduleMode: decision.scheduleMode,
  });

  try {
    const nodeAdapters = await resolveNodeAdapters();
    const result = await graph.invoke(
      new Command({ resume: decision }),
      { configurable: { services: svc, nodeAdapters, thread_id: threadId }, recursionLimit: 50 },
    );

    const finalSeq = Math.max(result.seq ?? 0, 500) + 1;
    await emitPipelineLog(base, "succeeded", finalSeq, `Pipeline completed — ${result.status}`, {
      finalStatus: result.status,
    });

    logger.info({ postId, status: result.status }, "post graph resumed and finished");
    return result;
  } catch (err) {
    const e = err as Error;
    await emitPipelineLog(base, "failed", 9999, `Pipeline failed after resume — ${e.message}`, undefined, e);
    logger.error({ postId, err: e.message }, "post graph failed after resume");
    throw err;
  }
}
