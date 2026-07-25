import type {
  AssetCandidate,
  Platform,
  PlatformImageSpec,
  StoredAssetRef,
} from "@visora/shared";

/**
 * Integration "ports" (hexagonal architecture). The orchestration nodes and
 * domain services depend ONLY on these interfaces — never on a concrete SDK.
 * Concrete adapters (OpenAI, Cloudinary, S3, Pexels, ...) implement them and
 * are wired in config/container.ts. Swapping a provider = new adapter, zero
 * changes to the graph.
 */

export interface UsageMeta {
  provider: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  imagesGenerated?: number;
  costUsd?: number;
  requestId?: string;
}

export interface GenerateImageParams {
  prompt: string;
  size?: "1024x1024" | "1792x1024" | "1024x1792";
}

export interface EditImageParams {
  /** Bytes of the source image to modify. */
  source: Buffer;
  sourceMime: string;
  instructions: string;
  /** Optional mask for inpainting. */
  mask?: Buffer;
}

export interface ImageResult {
  bytes: Buffer;
  mime: string;
  width: number;
  height: number;
  revisedPrompt?: string;
  usage: UsageMeta;
}

/** Text-to-image + image editing (DALL·E 3 by default). */
export interface ImageGenerator {
  readonly name: string;
  generate(params: GenerateImageParams): Promise<ImageResult>;
  edit(params: EditImageParams): Promise<ImageResult>;
}

/** General LLM text tasks: keyword extraction, caption authoring, relevance. */
export interface LanguageModel {
  readonly name: string;
  /** Returns parsed JSON of shape T given a schema-described instruction. */
  completeJson<T>(args: {
    system: string;
    user: string;
    schemaHint: string;
  }): Promise<{ value: T; usage: UsageMeta }>;
  complete(args: { system: string; user: string }): Promise<{
    text: string;
    usage: UsageMeta;
  }>;
}

export interface PutObjectParams {
  key: string;
  body: Buffer;
  contentType: string;
}

/** Object storage (S3 by default). */
export interface ObjectStore {
  readonly bucket: string;
  readonly region: string;
  put(params: PutObjectParams): Promise<StoredAssetRef>;
  get(key: string): Promise<{ body: Buffer; contentType: string }>;
  /** Presigned URL for direct browser access. */
  signedUrl(key: string, expiresInSec?: number): Promise<string>;
}

export interface ResizeResult {
  platform: Platform;
  cloudinaryUrl: string;
  s3Key: string;
  width: number;
  height: number;
  aspectRatio: string;
}

/** Per-platform resize/optimize (Cloudinary by default). */
export interface MediaOptimizer {
  readonly name: string;
  resizeForPlatform(args: {
    source: StoredAssetRef;
    sourceUrl: string;
    spec: PlatformImageSpec;
    /** S3/storage key prefix for the variant, e.g. "workspaces/{workspaceId}". */
    prefix: string;
  }): Promise<ResizeResult>;
}

export interface StockSearchParams {
  keywords: string[];
  limit: number;
}

/** Stock photo discovery (Pexels / Unsplash). */
export interface StockProvider {
  readonly name: string;
  search(params: StockSearchParams): Promise<AssetCandidate[]>;
}

export interface ScrapeResult {
  candidates: AssetCandidate[];
  pageTitle?: string;
}

/** Headless-browser web scraping (Playwright by default). */
export interface WebScraper {
  readonly name: string;
  extractImages(url: string): Promise<ScrapeResult>;
}

export interface PublishParams {
  platform: Platform;
  accountId: string;
  imageUrl: string;
  caption: string;
}

export interface PublishResult {
  externalPostId: string;
  permalink?: string;
}

/** Social network publisher (one impl per platform). */
export interface Publisher {
  readonly platform: Platform;
  publish(params: PublishParams): Promise<PublishResult>;
}
