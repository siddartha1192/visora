import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { AgentNode } from "@visora/shared";
import { Types } from "mongoose";
import type { ServiceContainer } from "../config/container.js";
import { AgentLogModel } from "../db/models/index.js";
import { logger } from "../lib/logger.js";
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

type NodeFn = (
  state: GraphStateType,
  ctx: NodeContext,
) => Promise<GraphUpdate>;

/**
 * Wraps a node so every execution emits AgentLog documents (started/succeeded/
 * failed) with timing + provider usage. This is the observability spine: the
 * node body only expresses business logic; logging is uniform and automatic.
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

    await AgentLogModel.create({ ...base, status: "started" }).catch((e) =>
      logger.error({ e, node }, "failed writing started log"),
    );

    try {
      const update = await fn(state, ctx);
      const durationMs = Date.now() - startedAt;
      const usage = update.usage?.[0];
      await AgentLogModel.create({
        ...base,
        status: "succeeded",
        durationMs,
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
      return { ...update, seq: sequence };
    } catch (err) {
      const e = err as Error;
      await AgentLogModel.create({
        ...base,
        status: "failed",
        durationMs: Date.now() - startedAt,
        error: { message: e.message, stack: e.stack },
      }).catch((le) => logger.error({ le, node }, "failed writing error log"));
      logger.error({ node, err: e.message }, "node failed");
      throw err;
    }
  };
}

function toId(id?: string) {
  return id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : undefined;
}

/** Keep AgentLog snapshots small — drop bulky binary-ish fields. */
function redact(update: GraphUpdate): Record<string, unknown> {
  const { variants, candidateAssets, ...rest } = update;
  return {
    ...rest,
    variantCount: variants?.length,
    candidateCount: candidateAssets?.length,
  };
}
