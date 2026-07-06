/**
 * FILE: context.ts
 * Two responsibilities:
 *
 * 1. NodeContext / getContext — injects the services container into every node via
 *    LangGraph's `configurable` object. Nodes never import adapters directly; they
 *    receive services through this context, keeping them pure and testable.
 *
 * 2. defineNode — a wrapper that adds automatic observability to every node.
 *    Any node wrapped with defineNode gets:
 *      - An AgentLog entry written to the database on start, success, and failure
 *      - A human-readable `message` and structured `data` field on each entry
 *      - Timing (duration in ms) and provider usage recorded automatically
 *      - Errors logged and re-thrown so the job queue can retry
 *    Node authors only write business logic — logging is handled here uniformly.
 *
 * 3. NodeMeta — transient fields nodes can include in their return value to
 *    enrich the log entry. defineNode strips them before passing the update to
 *    LangGraph so they never pollute the graph state.
 */
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { AgentNode } from "@visora/shared";
import { Types } from "mongoose";
import type { ServiceContainer } from "../config/container.js";
import { AgentLogModel } from "../db/models/index.js";
import { logger } from "../lib/logger.js";
import { appLog } from "../lib/logging/index.js";
import type { GraphStateType, GraphUpdate } from "./state.js";

/** Injected through LangGraph's `configurable` so nodes stay pure + testable. */
export interface NodeContext {
  services: ServiceContainer;
}

export function getContext(config: LangGraphRunnableConfig): NodeContext {
  const services = config.configurable?.services as ServiceContainer | undefined;
  if (!services) throw new Error("NodeContext.services missing from config");
  return { services };
}

/**
 * Transient logging metadata nodes can include in their return value.
 * defineNode reads these fields, writes them to AgentLog, then strips them
 * before passing the update to LangGraph — they never enter the graph state.
 */
export interface NodeMeta {
  /** One-line human-readable summary shown in the UI log viewer on success. */
  logMessage?: string;
  /** Small structured key/value object shown alongside the message in the UI. */
  logData?: Record<string, unknown>;
}

/** Full return type for node functions — graph update + optional log metadata. */
export type NodeReturn = GraphUpdate & NodeMeta;

type NodeFn = (
  state: GraphStateType,
  ctx: NodeContext,
) => Promise<NodeReturn>;

/**
 * Wraps a node so every execution emits AgentLog documents (started/succeeded/
 * failed) with timing, human-readable messages, and structured UI data.
 * This is the observability spine: node bodies only express business logic.
 *
 * A thrown error is logged then re-thrown so BullMQ retry + the graph's failure
 * path engage — partial state already merged is preserved by the checkpointer.
 */
export function defineNode(node: AgentNode, fn: NodeFn) {
  return async (
    state: GraphStateType,
    config: LangGraphRunnableConfig,
  ): Promise<GraphUpdate> => {
    const ctx = getContext(config);
    const sequence = (state.seq ?? 0) + 1;
    const startedAt = Date.now();
    const base = {
      workspaceId: toId(state.workspaceId),
      postId: toId(state.postId),
      jobId: toId(state.jobId),
      threadId: state.threadId,
      node,
      sequence,
    };

    const nodeLog = appLog.child({
      node,
      jobId: state.jobId,
      postId: state.postId,
      workspaceId: state.workspaceId,
      workflow: state.workflow,
      sequence,
    });

    await AgentLogModel.create({
      ...base,
      status: "started",
      message: `${node}: started`,
    }).catch((e) => logger.error({ e, node }, "failed writing started log"));
    nodeLog.info(`${node}: started`);

    try {
      const nodeReturn = await fn(state, ctx);

      // Strip transient log metadata before returning to LangGraph.
      const { logMessage, logData, ...update } = nodeReturn;

      const durationMs = Date.now() - startedAt;
      const usage = update.usage?.[0];
      const successMessage = logMessage ?? `${node}: completed in ${durationMs}ms`;

      await AgentLogModel.create({
        ...base,
        status: "succeeded",
        durationMs,
        message: successMessage,
        ...(logData ? { data: logData } : {}),
        output: redact(update),
        ...(usage
          ? {
              provider: { name: usage.provider, model: usage.model },
              usage: {
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                imagesGenerated: usage.imagesGenerated,
                costUsd: usage.costUsd,
              },
            }
          : {}),
      }).catch((e) => logger.error({ e, node }, "failed writing success log"));

      nodeLog.info(`${node}: succeeded`, { durationMs, message: successMessage });
      return { ...update, seq: sequence };
    } catch (err) {
      const e = err as Error;
      const durationMs = Date.now() - startedAt;
      const failMessage = `${node}: failed — ${e.message}`;

      await AgentLogModel.create({
        ...base,
        status: "failed",
        durationMs,
        message: failMessage,
        error: { message: e.message, stack: e.stack },
      }).catch((le) => logger.error({ le, node }, "failed writing error log"));

      nodeLog.error(`${node}: failed`, { durationMs, err: e.message });
      throw err;
    }
  };
}

function toId(id?: string) {
  return id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : undefined;
}

/** Keep AgentLog output snapshots small — drop bulky binary-ish fields. */
function redact(update: GraphUpdate): Record<string, unknown> {
  const { variants, candidateAssets, ...rest } = update;
  return {
    ...rest,
    variantCount: variants?.length,
    candidateCount: candidateAssets?.length,
  };
}
