/**
 * FILE: registry.ts
 * The single plug-in point for adding new workflow types.
 *
 * Maps every WorkflowType to a node ID and its handler function.
 * The graph's router reads this registry to decide which subgraph to run after ingest.
 *
 * Current workflows:
 *  - passthrough     — use an image the user already uploaded (no AI cost)
 *  - ai_generate     — generate a new image from a prompt using DALL·E
 *  - ai_enhance      — edit/modify an existing image using DALL·E
 *  - stock_discovery — search Pexels/Unsplash for a matching stock photo
 *  - scrape          — extract the best image from a web page URL
 *
 * To add a 6th workflow: add one entry here and a matching literal to the shared WORKFLOWS enum.
 * graph.ts, optimization, caption, publish, and persist nodes require zero changes.
 */
import type { WorkflowType } from "@visora/shared";
import { passthroughNode } from "./subgraphs/passthrough.node.js";
import { generationNode } from "./subgraphs/generation.node.js";
import { enhancementNode } from "./subgraphs/enhancement.node.js";
import { stockNode } from "./subgraphs/stock.node.js";
import { scrapingNode } from "./subgraphs/scraping.node.js";

/**
 * The single plug-in point. Each workflow maps to a graph node name + handler.
 * Adding a 6th workflow = add an entry here (and a literal to the shared
 * WORKFLOWS enum). The router and the optimization/caption/publish/persist tail
 * require zero changes — they operate on the converged state shape.
 */
/** A compiled node handler (state, config) => Promise<partial state>. */
export type NodeHandler = typeof passthroughNode;

export interface WorkflowDefinition {
  /** Node id registered on the graph (must be unique). */
  nodeId: string;
  handler: NodeHandler;
}

/** Workflows that map directly to graph nodes. "autonomous" is excluded — it routes via the planner node. */
export type ExecutableWorkflow = Exclude<WorkflowType, "autonomous">;

export const WORKFLOW_REGISTRY: Record<ExecutableWorkflow, WorkflowDefinition> = {
  passthrough: { nodeId: "passthrough", handler: passthroughNode },
  ai_generate: { nodeId: "generation", handler: generationNode },
  ai_enhance: { nodeId: "enhancement", handler: enhancementNode },
  stock_discovery: { nodeId: "stock", handler: stockNode },
  scrape: { nodeId: "scraping", handler: scrapingNode },
};

export const WORKFLOW_NODE_IDS = Object.values(WORKFLOW_REGISTRY).map(
  (d) => d.nodeId,
);
