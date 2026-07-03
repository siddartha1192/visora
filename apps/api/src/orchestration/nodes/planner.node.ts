/**
 * FILE: planner.node.ts
 * The "autonomous" workflow's first node. Reads the user's freeform brief and
 * uses an LLM to decide:
 *  - Which concrete workflow to run (stock, generate, scrape, enhance, passthrough)
 *  - Which platforms to post to (extracted from the brief)
 *  - Whether to schedule for a future time (and when)
 *
 * This is what makes the app truly agentic: the LLM acts as a controller,
 * not just a transformer.
 */
import { Types } from "mongoose";
import { PostModel } from "../../db/models/index.js";
import { logger } from "../../lib/logger.js";
import { defineNode } from "../context.js";
import type { GraphTarget } from "@visora/shared";
import type { ExecutableWorkflow } from "../registry.js";

const PLACEHOLDER_ACCOUNT = "000000000000000000000000";

interface PlannerDecision {
  workflow: "ai_enhance" | "passthrough" | "stock_discovery" | "ai_generate" | "scrape";
  /** DALL-E modification instructions — only when workflow is "ai_enhance". */
  instructions?: string | null;
  /** Search keywords (stock) or generation prompt (ai_generate). */
  prompt?: string | null;
  /** URL to extract from — only when workflow is "scrape". */
  sourceUrl?: string | null;
  /** Image selector hint — only when workflow is "scrape". */
  context?: string | null;
  /** Enhance the downloaded stock photo — only when workflow is "stock_discovery". */
  enhanceAfterStock?: boolean | null;
  /** DALL-E editing instructions for post-download enhancement. */
  enhanceInstructions?: string | null;
  /** Platforms extracted from the brief. null/empty = keep the user's selection. */
  platforms?: Array<"instagram" | "facebook" | "x" | "linkedin"> | null;
  /** "scheduled" if the brief mentions a future time, otherwise "instant". */
  scheduleMode?: "instant" | "scheduled" | null;
  /** ISO 8601 UTC timestamp for scheduled posts. Null if instant. */
  scheduledAt?: string | null;
  reasoning: string;
}

const PLATFORM_SECTION = `
Platform detection:
- platforms: list social media platforms mentioned in the brief.
  Valid values: "instagram", "facebook", "x" (for Twitter/X), "linkedin".
  If no platform is mentioned, default to ["instagram"].`;

const buildScheduleSection = (nowUtc: string) => `
Schedule detection (current UTC time: ${nowUtc}):
- scheduleMode: "scheduled" if the brief mentions posting at a specific future time or date; otherwise default to "instant".
- scheduledAt: when scheduleMode is "scheduled", the target ISO 8601 UTC datetime string.
  Convert relative references ("tomorrow at 9am", "next Monday", "in 2 hours") to absolute UTC.
  If scheduled but no specific time is given, default to 24 hours from now (${new Date(Date.now() + 86400000).toISOString()}).
  Leave null when scheduleMode is "instant".`;

export const plannerNode = defineNode("planner", async (state, ctx) => {
  const brief = state.input.brief;
  if (!brief) throw new Error("planner: autonomous mode requires a brief");

  const hasUploadedImage = Boolean(state.input.uploadedAssetId);
  const nowUtc = new Date().toISOString();

  logger.info({ postId: state.postId, brief, hasUploadedImage }, "planner: analyzing brief");

  const systemPrompt = hasUploadedImage
    ? `You are an AI content strategist for a social media scheduling platform.
The user has uploaded an image. Decide how to use it based on their brief:

- "ai_enhance": MODIFY the uploaded image using AI (DALL-E edit). Choose this when the brief implies improving, retouching, stylizing, color-grading, or transforming the image — even if the user does not say "enhance" explicitly. If the image likely needs work to match the desired look, choose ai_enhance.
- "passthrough": POST the image as-is, no AI modification. Choose this only when the brief clearly says the image is ready and just needs posting.

When workflow is "ai_enhance", write instructions: concise, specific DALL-E editing instructions that will achieve the look described in the brief.
${PLATFORM_SECTION}
${buildScheduleSection(nowUtc)}

Return JSON with:
- workflow: "ai_enhance" | "passthrough"
- instructions: DALL-E editing instructions string (required when workflow is "ai_enhance")
- platforms: array of platform strings (or empty array if not mentioned)
- scheduleMode: "instant" | "scheduled"
- scheduledAt: ISO 8601 UTC string or null
- reasoning: one sentence explaining your choices`
    : `You are an AI content strategist for a social media scheduling platform.
No image was uploaded. Decide how to source the image from the brief:

- "stock_discovery": find a real photograph from stock libraries. Use for people, nature, lifestyle, business, food, travel, products.
- "ai_generate": generate a new image with DALL-E. Use for conceptual, artistic, branded, surreal, or highly specific visuals that real photos cannot deliver.
- "scrape": extract an image from a URL. ONLY when the brief explicitly mentions a URL.

Default to "stock_discovery" when in doubt — it is faster and cheaper.

Enhancement for stock_discovery:
- Set enhanceAfterStock: true when the brief implies a specific visual style, color grade, or mood that a raw stock photo likely won't match (e.g. "warm golden hour feel", "dark moody brand", "cinematic look").
- When enhanceAfterStock is true, write enhanceInstructions: DALL-E editing instructions to apply that look.
${PLATFORM_SECTION}
${buildScheduleSection(nowUtc)}

Return JSON with:
- workflow: "stock_discovery" | "ai_generate" | "scrape"
- prompt: for stock_discovery → 4-8 search keywords; for ai_generate → detailed DALL-E image prompt
- sourceUrl: the URL (scrape only)
- context: image selector hint (scrape only)
- enhanceAfterStock: true | false
- enhanceInstructions: DALL-E editing instructions (only when enhanceAfterStock is true)
- platforms: array of platform strings (or empty array if not mentioned)
- scheduleMode: "instant" | "scheduled"
- scheduledAt: ISO 8601 UTC string or null
- reasoning: one sentence explaining your choices`;

  const schemaHint = hasUploadedImage
    ? `{ "workflow": "ai_enhance" | "passthrough", "instructions"?: string, "platforms": string[], "scheduleMode": "instant" | "scheduled", "scheduledAt"?: string, "reasoning": string }`
    : `{ "workflow": "stock_discovery" | "ai_generate" | "scrape", "prompt"?: string, "sourceUrl"?: string, "context"?: string, "enhanceAfterStock"?: boolean, "enhanceInstructions"?: string, "platforms": string[], "scheduleMode": "instant" | "scheduled", "scheduledAt"?: string, "reasoning": string }`;

  const { value: decision, usage } =
    await ctx.services.languageModel.completeJson<PlannerDecision>({
      system: systemPrompt,
      user: `User brief: "${brief}"`,
      schemaHint,
    });

  const resolvedWorkflow = decision.workflow as ExecutableWorkflow;
  const enhanceAfterStock =
    resolvedWorkflow === "stock_discovery" && Boolean(decision.enhanceAfterStock);

  // ── Platform resolution ───────────────────────────────────────────────────
  // Use platforms extracted from the brief when present; otherwise fall back
  // to whatever platforms the user pre-selected in the UI.
  const extractedPlatforms = (decision.platforms ?? []).filter(Boolean);
  const defaultAccountId = state.targets[0]?.accountId ?? PLACEHOLDER_ACCOUNT;

  let resolvedTargets: GraphTarget[];
  if (extractedPlatforms.length > 0) {
    resolvedTargets = extractedPlatforms.map((p) => ({
      platform: p as GraphTarget["platform"],
      accountId: defaultAccountId,
    }));
  } else if (state.targets.length > 0) {
    resolvedTargets = state.targets; // Keep the user's manual selection
  } else {
    resolvedTargets = [{ platform: "instagram", accountId: defaultAccountId }];
  }

  // ── Schedule resolution ───────────────────────────────────────────────────
  const resolvedScheduleMode =
    decision.scheduleMode === "scheduled" ? "scheduled" : "instant";

  if (resolvedScheduleMode === "scheduled" && decision.scheduledAt) {
    try {
      const runAt = new Date(decision.scheduledAt);
      if (!isNaN(runAt.getTime()) && runAt > new Date()) {
        await PostModel.updateOne(
          { _id: new Types.ObjectId(state.postId) },
          { $set: { "schedule.mode": "scheduled", "schedule.runAt": runAt } },
        );
        logger.info(
          { postId: state.postId, scheduledAt: runAt.toISOString() },
          "planner: post rescheduled",
        );
      }
    } catch (err) {
      logger.warn({ postId: state.postId, err }, "planner: failed to parse scheduledAt, using instant");
    }
  }

  logger.info(
    {
      postId: state.postId,
      resolvedWorkflow,
      hasUploadedImage,
      platforms: resolvedTargets.map((t) => t.platform),
      scheduleMode: resolvedScheduleMode,
      scheduledAt: decision.scheduledAt ?? undefined,
      prompt: decision.prompt ?? undefined,
      instructions: decision.instructions ?? undefined,
      enhanceAfterStock,
      reasoning: decision.reasoning,
    },
    "planner: workflow resolved",
  );

  return {
    resolvedWorkflow,
    targets: resolvedTargets,
    scheduleMode: resolvedScheduleMode,
    input: {
      ...state.input,
      instructions: decision.instructions ?? undefined,
      prompt: decision.prompt ?? undefined,
      sourceUrl: decision.sourceUrl ?? undefined,
      context: decision.context ?? undefined,
      stockSource: "auto" as const,
      enhanceAfterStock,
      enhanceInstructions: enhanceAfterStock
        ? (decision.enhanceInstructions ?? undefined)
        : undefined,
    },
    captionRequest: {
      generate: true,
      hashtags: [],
    },
    usage: [{ node: "planner", provider: usage.provider, model: usage.model }],
  };
});
