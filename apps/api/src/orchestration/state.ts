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
