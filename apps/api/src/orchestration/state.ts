/**
 * FILE: state.ts
 * Defines the shared state (the "baton") that flows through every node in the pipeline.
 *
 * Each node receives the full state, does its work, and returns only the fields it changed.
 * LangGraph merges those partial updates back into the state automatically.
 *
 * Special reducers:
 *  - `errors` and `usage` use append reducers — every node's entries accumulate into a full audit trail
 *  - `published` appends per-platform publish results
 *  - `seq` keeps the highest sequence number seen (for log ordering)
 *  - `status` is always overwritten by the latest node
 */
import { Annotation } from "@langchain/langgraph";
import type {
  AssetCandidate,
  AssetVariant,
  GraphTarget,
  NodeError,
  StoredAssetRef,
  UsageRecord,
  WorkflowType,
} from "@visora/shared";

/**
 * The LangGraph channel definition. Each node returns a partial of this shape;
 * LangGraph merges via the reducers below. `errors` and `usage` use append
 * reducers so every node's contribution accumulates into a full audit trail.
 */
export const GraphState = Annotation.Root({
  // --- identity (set once at ingest) ---
  workspaceId: Annotation<string>(),
  postId: Annotation<string>(),
  jobId: Annotation<string>(),
  threadId: Annotation<string>(),
  workflow: Annotation<WorkflowType>(),

  // --- inputs ---
  input: Annotation<{
    prompt?: string;
    instructions?: string;
    sourceUrl?: string;
    uploadedAssetId?: string;
    context?: string;
    stockSource?: "auto" | "pexels" | "unsplash";
    enhanceAfterStock?: boolean;
    enhanceInstructions?: string;
  }>(),
  targets: Annotation<GraphTarget[]>(),
  captionRequest: Annotation<{
    text?: string;
    hashtags: string[];
    generate: boolean;
  }>(),
  scheduleMode: Annotation<"instant" | "scheduled">(),

  // --- working artifacts ---
  rawAsset: Annotation<StoredAssetRef | undefined>(),
  candidateAssets: Annotation<AssetCandidate[] | undefined>(),
  processedAsset: Annotation<StoredAssetRef | undefined>(),
  /** The asset that flows into optimization (raw or processed). */
  primaryAssetUrl: Annotation<string | undefined>(),
  /** Set by the review node after the human-approval interrupt resolves. */
  approvalStatus: Annotation<"approved" | "rejected" | undefined>(),
  variants: Annotation<Array<AssetVariant & { variantId: string }> | undefined>(),
  caption: Annotation<
    { text: string; hashtags: string[]; generated: boolean } | undefined
  >(),
  published: Annotation<
    Array<{
      platform: string;
      accountId: string;
      externalPostId?: string;
      permalink?: string;
      status: "published" | "failed";
      error?: string;
    }>
  >({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),

  // --- accounting (append reducers) ---
  errors: Annotation<NodeError[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  usage: Annotation<UsageRecord[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),

  // --- sequence counter for AgentLog ordering ---
  seq: Annotation<number>({
    reducer: (a, b) => Math.max(a, b),
    default: () => 0,
  }),

  status: Annotation<"running" | "ready" | "published" | "failed">({
    reducer: (_a, b) => b,
    default: () => "running",
  }),
});

export type GraphStateType = typeof GraphState.State;
export type GraphUpdate = Partial<GraphStateType>;
