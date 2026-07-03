import type { AgentNode, Platform, WorkflowType } from "../constants/enums.js";
import type { AssetVariant } from "./domain.js";

/** A handle to a stored object plus the metadata downstream nodes need. */
export interface StoredAssetRef {
  assetId?: string;
  s3Key: string;
  bucket: string;
  region: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

/** A stock/scrape candidate before selection. */
export interface AssetCandidate {
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  source: string;
  providerMeta?: Record<string, unknown>;
  /** Relevance score assigned by the selection step (0..1). */
  score?: number;
}

export interface NodeError {
  node: AgentNode;
  message: string;
  code?: string;
  at: string;
}

export interface UsageRecord {
  node: AgentNode;
  provider: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  imagesGenerated?: number;
  costUsd?: number;
}

export interface GraphTarget {
  platform: Platform;
  accountId: string;
}

/**
 * The plain-object shape of the LangGraph channel state. The worker maps this
 * onto a LangGraph `Annotation.Root` with reducers (errors/usage append-merge).
 * Keeping the shape here lets the API and tests reason about runs without
 * importing the LangGraph runtime.
 */
export interface GraphStateShape {
  workspaceId: string;
  postId: string;
  jobId: string;
  threadId: string;
  workflow: WorkflowType;

  input: {
    prompt?: string;
    instructions?: string;
    sourceUrl?: string;
    uploadedAssetId?: string;
    context?: string;
  };
  targets: GraphTarget[];

  rawAsset?: StoredAssetRef;
  candidateAssets?: AssetCandidate[];
  processedAsset?: StoredAssetRef;
  variants?: Array<AssetVariant & { variantId: string }>;
  caption?: { text: string; hashtags: string[]; generated: boolean };

  errors: NodeError[];
  usage: UsageRecord[];
  status: "running" | "ready" | "published" | "failed";
}
