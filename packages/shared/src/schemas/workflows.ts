import { z } from "zod";
import {
  captionSchema,
  objectIdSchema,
  publishTargetSchema,
  scheduleSchema,
} from "./common.js";

/**
 * One discriminated request schema per workflow. The `workflow` field is the
 * discriminant the LangGraph router branches on. The external REST API and the
 * web BFF both validate against these — guaranteeing every entrypoint produces
 * a structurally identical Post draft.
 */

const baseFields = {
  targets: z.array(publishTargetSchema).min(1, "at least one target required"),
  schedule: scheduleSchema,
  caption: captionSchema.optional(),
};

export const passthroughInputSchema = z.object({
  workflow: z.literal("passthrough"),
  /** Asset already uploaded via the assets endpoint (multipart -> S3). */
  uploadedAssetId: objectIdSchema,
  ...baseFields,
});

export const aiGenerateInputSchema = z.object({
  workflow: z.literal("ai_generate"),
  prompt: z.string().min(3).max(4000),
  ...baseFields,
});

export const aiEnhanceInputSchema = z.object({
  workflow: z.literal("ai_enhance"),
  uploadedAssetId: objectIdSchema,
  instructions: z.string().min(3).max(4000),
  ...baseFields,
});

export const stockDiscoveryInputSchema = z.object({
  workflow: z.literal("stock_discovery"),
  prompt: z.string().min(3).max(2000),
  /** Optional cap on candidates fetched before selection. */
  maxCandidates: z.number().int().min(1).max(30).default(10),
  /** Pin search to a specific provider, or let the system try Pexels → Unsplash. */
  stockSource: z.enum(["auto", "pexels", "unsplash"]).default("auto"),
  /** When true, the downloaded stock photo is passed through AI enhancement. */
  enhanceAfterStock: z.boolean().default(false),
  /** Instructions for the AI when enhanceAfterStock is true. Falls back to a sensible default. */
  enhanceInstructions: z.string().max(2000).optional(),
  ...baseFields,
});

export const scrapeInputSchema = z.object({
  workflow: z.literal("scrape"),
  sourceUrl: z.string().url(),
  /** Natural-language hint the agent uses to pick the most relevant image. */
  context: z.string().min(3).max(2000),
  ...baseFields,
});

export const createPostSchema = z.discriminatedUnion("workflow", [
  passthroughInputSchema,
  aiGenerateInputSchema,
  aiEnhanceInputSchema,
  stockDiscoveryInputSchema,
  scrapeInputSchema,
]);

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type PassthroughInput = z.infer<typeof passthroughInputSchema>;
export type AiGenerateInput = z.infer<typeof aiGenerateInputSchema>;
export type AiEnhanceInput = z.infer<typeof aiEnhanceInputSchema>;
export type StockDiscoveryInput = z.infer<typeof stockDiscoveryInputSchema>;
export type ScrapeInput = z.infer<typeof scrapeInputSchema>;
