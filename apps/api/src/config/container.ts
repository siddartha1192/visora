import type { Platform } from "@visora/shared";
import { PLATFORMS } from "@visora/shared";
import { logger } from "../lib/logger.js";
import { env } from "./env.js";

import type {
  ImageGenerator,
  LanguageModel,
  MediaOptimizer,
  ObjectStore,
  Publisher,
  StockProvider,
  WebScraper,
} from "../integrations/interfaces/ports.js";

import { S3ObjectStore } from "../integrations/storage/s3.adapter.js";
import { LocalDiskObjectStore } from "../integrations/storage/local-disk.adapter.js";
import {
  OpenAIImageGenerator,
  OpenAILanguageModel,
} from "../integrations/llm/openai.adapter.js";
import {
  StubImageGenerator,
  StubLanguageModel,
} from "../integrations/llm/stub.adapter.js";
import { CloudinaryOptimizer } from "../integrations/media/cloudinary.adapter.js";
import { StubMediaOptimizer } from "../integrations/media/stub.adapter.js";
import { PexelsStockProvider } from "../integrations/stock/pexels.adapter.js";
import { UnsplashStockProvider } from "../integrations/stock/unsplash.adapter.js";
import { StubStockProvider } from "../integrations/stock/stub.adapter.js";
import { PlaywrightScraper } from "../integrations/scraping/playwright.adapter.js";
import { StubScraper } from "../integrations/scraping/stub.adapter.js";
import { StubPublisher } from "../integrations/publishers/stub.publisher.js";

/**
 * The service container is the ONLY place concrete adapters are instantiated.
 * Everything downstream (graph nodes, services) receives this bundle of ports.
 * Swapping a provider is a one-line change here.
 *
 * Each capability degrades gracefully to a deterministic stub when its
 * credentials are absent, so `pnpm dev` runs the full 5-workflow pipeline with
 * zero paid keys — and production lights up real providers by setting env vars.
 */
export interface ServiceContainer {
  imageGenerator: ImageGenerator;
  languageModel: LanguageModel;
  objectStore: ObjectStore;
  mediaOptimizer: MediaOptimizer;
  /** Primary stock provider; secondary used as fallback in the stock subgraph. */
  stockProviders: StockProvider[];
  scraper: WebScraper;
  publishers: Record<Platform, Publisher>;
}

let cached: ServiceContainer | null = null;

export function createContainer(): ServiceContainer {
  if (cached) return cached;

  const usingStub: string[] = [];

  const imageGenerator: ImageGenerator = env.OPENAI_API_KEY
    ? new OpenAIImageGenerator()
    : (usingStub.push("imageGenerator"), new StubImageGenerator());

  const languageModel: LanguageModel = env.OPENAI_API_KEY
    ? new OpenAILanguageModel()
    : (usingStub.push("languageModel"), new StubLanguageModel());

  const objectStore: ObjectStore =
    env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? new S3ObjectStore()
      : new LocalDiskObjectStore();

  const hasCloudinary =
    Boolean(env.CLOUDINARY_URL) ||
    Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY);
  const mediaOptimizer: MediaOptimizer = hasCloudinary
    ? new CloudinaryOptimizer()
    : (usingStub.push("mediaOptimizer"), new StubMediaOptimizer());

  const stockProviders: StockProvider[] = [];
  if (env.PEXELS_API_KEY) stockProviders.push(new PexelsStockProvider());
  if (env.UNSPLASH_ACCESS_KEY) stockProviders.push(new UnsplashStockProvider());
  if (stockProviders.length === 0) {
    usingStub.push("stockProvider");
    stockProviders.push(new StubStockProvider());
  }

  // Playwright is opt-in (requires installed browser binaries).
  const scraper: WebScraper =
    env.NODE_ENV === "production" || process.env.ENABLE_PLAYWRIGHT === "true"
      ? new PlaywrightScraper()
      : (usingStub.push("scraper"), new StubScraper());

  const publishers = Object.fromEntries(
    PLATFORMS.map((p) => [p, new StubPublisher(p)]),
  ) as Record<Platform, Publisher>;
  usingStub.push("publishers(all)");

  if (usingStub.length > 0) {
    logger.warn(
      { stubbed: usingStub },
      "service container: using stub adapters for capabilities without credentials",
    );
  }

  cached = {
    imageGenerator,
    languageModel,
    objectStore,
    mediaOptimizer,
    stockProviders,
    scraper,
    publishers,
  };
  return cached;
}
