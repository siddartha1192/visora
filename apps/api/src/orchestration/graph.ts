/**
 * FILE: graph.ts
 * Assembles the full post-processing pipeline as a LangGraph StateGraph.
 * This is the blueprint that wires every node together in the correct order.
 *
 * Pipeline flow:
 *   START → ingest → [workflow subgraph] → optimization → caption
 *         → (instant) publish → persist → END
 *         → (scheduled) persist → END
 *
 * Two decision forks:
 *  - ROUTER (after ingest): picks which workflow subgraph to run based on post type
 *  - SCHEDULE GATE (after caption): publishes immediately or stops at "ready" for later
 *
 * Adding a new workflow only requires adding it to registry.ts — nothing changes here.
 */
import { END, START, StateGraph } from "@langchain/langgraph";
import type { ServiceContainer } from "../config/container.js";
import { GraphState, type GraphStateType } from "./state.js";
import { WORKFLOW_REGISTRY, type ExecutableWorkflow } from "./registry.js";
import { ingestNode } from "./nodes/ingest.node.js";
import { moderationNode } from "./nodes/moderation.node.js";
import { plannerNode } from "./nodes/planner.node.js";
import { optimizationNode } from "./nodes/optimization.node.js";
import { captionNode } from "./nodes/caption.node.js";
import { reviewNode } from "./nodes/review.node.js";
import { publishNode } from "./nodes/publish.node.js";
import { persistNode } from "./nodes/persist.node.js";
import { createCheckpointer } from "./checkpointer/mongo-checkpointer.js";

/**
 * Assembles the root execution graph:
 *
 *   START → ingest → ROUTER → {workflow subgraph} → optimization → caption
 *         → SCHEDULE GATE → (instant) publish → persist → END
 *                         → (scheduled) persist → END
 *
 * The ROUTER is a conditional edge keyed on `state.workflow`; the SCHEDULE GATE
 * is a conditional edge keyed on `state.scheduleMode`. The workflow subgraphs
 * are registered from WORKFLOW_REGISTRY so new workflows need no edits here.
 */
export async function buildGraph(_services: ServiceContainer) {
  const graph = new StateGraph(GraphState)
    .addNode("ingest", ingestNode)
    .addNode("moderation", moderationNode)
    .addNode("planner", plannerNode)
    .addNode("optimization", optimizationNode)
    .addNode("write_caption", captionNode)
    .addNode("review", reviewNode)
    .addNode("publish", publishNode)
    .addNode("persist", persistNode);

  // Register every executable workflow node from the registry.
  for (const def of Object.values(WORKFLOW_REGISTRY)) {
    graph.addNode(def.nodeId, def.handler);
    // Each workflow converges on optimization.
    graph.addEdge(def.nodeId as never, "optimization" as never);
  }

  graph.addEdge(START, "ingest" as never);
  // Content policy gate: every run passes through moderation after ingest and
  // before any LLM or image provider is called.
  graph.addEdge("ingest" as never, "moderation" as never);

  const workflowNodeMap = Object.fromEntries(
    Object.values(WORKFLOW_REGISTRY).map((d) => [d.nodeId, d.nodeId]),
  );

  // ROUTER: branch from moderation to the workflow node for state.workflow.
  // "autonomous" posts go to the planner node first; all others go directly to their workflow node.
  graph.addConditionalEdges(
    "moderation" as never,
    (state: GraphStateType) => {
      if (state.workflow === "autonomous") return "planner";
      return WORKFLOW_REGISTRY[state.workflow as ExecutableWorkflow].nodeId;
    },
    { planner: "planner", ...workflowNodeMap } as never,
  );

  // PLANNER → resolved workflow: after the planner sets resolvedWorkflow, route to the chosen node.
  graph.addConditionalEdges(
    "planner" as never,
    (state: GraphStateType) =>
      WORKFLOW_REGISTRY[state.resolvedWorkflow as ExecutableWorkflow].nodeId,
    workflowNodeMap as never,
  );

  graph.addEdge("optimization" as never, "write_caption" as never);
  graph.addEdge("write_caption" as never, "review" as never);

  // APPROVAL + SCHEDULE GATE: after human review, route based on decision and schedule mode.
  graph.addConditionalEdges(
    "review" as never,
    (state: GraphStateType) => {
      if (state.approvalStatus === "rejected") return "persist"; // skip publish, mark rejected
      return state.scheduleMode === "instant" ? "publish" : "persist";
    },
    { publish: "publish", persist: "persist" } as never,
  );

  graph.addEdge("publish" as never, "persist" as never);
  graph.addEdge("persist" as never, END);

  const checkpointer = await createCheckpointer();
  return graph.compile(checkpointer ? { checkpointer } : {});
}

export type CompiledGraph = Awaited<ReturnType<typeof buildGraph>>;
