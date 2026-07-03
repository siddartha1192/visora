/**
 * FILE: runner.ts
 * The entry point called by the BullMQ background job worker to execute the pipeline.
 *
 * Responsibilities:
 *  - Compiles the graph once per process and reuses it for all subsequent runs (singleton)
 *  - Converts a PostDoc database document into the initial GraphState the pipeline expects
 *  - Injects the services container via `configurable` so nodes never import providers directly
 *  - Ties each run to a `thread_id` (= jobId) so the checkpointer can resume a crashed run
 */
import { Command } from "@langchain/langgraph";
import type { PostDoc } from "../db/models/index.js";
import { createContainer, type ServiceContainer } from "../config/container.js";
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
    scheduleMode: post.schedule?.mode ?? "instant",
    status: "running",
  };
}

/**
 * Executes the full graph for a post. Called by the BullMQ worker. The services
 * container is injected via `configurable` so nodes never import providers; the
 * thread_id ties the run to its checkpoint for resumability.
 */
export async function runPostGraph(post: PostDoc, jobId: string) {
  const { graph, services: svc } = await getGraph();
  logger.info(
    { postId: post._id.toString(), workflow: post.workflow, jobId },
    "running post graph",
  );

  const result = await graph.invoke(initialState(post, jobId), {
    configurable: { services: svc, thread_id: jobId },
    recursionLimit: 50,
  });

  logger.info(
    { postId: post._id.toString(), status: result.status },
    "post graph finished",
  );
  return result;
}

/**
 * Resumes a graph that was paused at the review interrupt.
 * Called by the approve / reject API endpoints — not the worker.
 */
export async function resumePostGraph(
  post: PostDoc,
  decision: { approved: boolean },
) {
  if (!post.jobId) throw new Error(`resumePostGraph: post ${post._id} has no jobId — cannot resume`);
  const { graph, services: svc } = await getGraph();
  const threadId = post.jobId.toString();

  logger.info(
    { postId: post._id.toString(), approved: decision.approved },
    "resuming post graph after review",
  );

  const result = await graph.invoke(
    new Command({ resume: decision }),
    { configurable: { services: svc, thread_id: threadId }, recursionLimit: 50 },
  );

  logger.info(
    { postId: post._id.toString(), status: result.status },
    "post graph resumed and finished",
  );
  return result;
}
