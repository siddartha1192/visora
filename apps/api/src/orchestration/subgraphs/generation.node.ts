/**
 * FILE: generation.node.ts
 * Workflow 2 — generates a brand-new image from a text prompt using DALL·E.
 * Mini-pipeline inside this node:
 *  1. GPT refines the user's raw prompt into a more vivid image-generation prompt (best-effort)
 *  2. DALL·E generates the image
 *  3. Result is stored to S3 + recorded as an Asset in the database
 * Falls back to the original prompt if the GPT refinement step fails.
 */
import { defineNode } from "../context.js";
import { storeImageAsset } from "../asset-helper.js";
import { moderateTexts, ContentPolicyViolationError, HIGH_RISK_KEYWORDS } from "../../lib/moderation.js";

/**
 * Workflow 2 — Pure AI Generation. Internally a mini-pipeline:
 *   promptRefine (LLM) -> DALL·E 3 generate -> store to object store + Asset.
 * The refined prompt step is best-effort; failure falls back to the raw prompt.
 */
export const generationNode = defineNode("generation", async (state, ctx) => {
  const prompt = state.input.prompt;
  if (!prompt) throw new Error("generation: prompt is required");

  // Pre-filter: catch terms the Moderation API scoring threshold misses.
  if (HIGH_RISK_KEYWORDS.some((re) => re.test(prompt))) {
    throw new Error("generation: content policy violation — prompt contains prohibited terms");
  }

  let finalPrompt = prompt;
  const nodeAdapters = ctx.nodeAdapters?.generation;
  const lm = nodeAdapters?.languageModel ?? ctx.services.languageModel;
  const ig = nodeAdapters?.imageGenerator ?? ctx.services.imageGenerator;

  // Refine the prompt with the LLM. We deliberately do NOT catch the
  // POLICY_VIOLATION throw here — it must propagate to fail the pipeline.
  // Only genuine LLM network/API errors fall back to the raw prompt.
  let refinedText: string | null = null;
  try {
    const refined = await lm.complete({
      system:
        "Rewrite the user's idea into a vivid, detailed image-generation prompt. Return only the prompt.\n\n" +
        "CONTENT POLICY — strictly enforced. Never produce a prompt that:\n" +
        "• Depicts nudity, pornography, or sexually explicit scenes\n" +
        "• Is derogatory toward any person or group\n" +
        "• Promotes political parties, electoral candidates, or partisan political messaging\n" +
        "• Expresses bias or discrimination based on gender, caste, religion, race, or ethnicity\n" +
        "• Contains violent, abusive, or threatening imagery\n" +
        "If the user's idea violates these policies, return exactly: POLICY_VIOLATION",
      user: prompt,
    });
    refinedText = refined.text.trim();
  } catch {
    /* LLM call failed — fall back to raw prompt, policy guards still apply below */
  }

  if (refinedText === "POLICY_VIOLATION") {
    throw new Error("generation: content policy violation detected in prompt");
  }
  if (refinedText && refinedText.length > 0) {
    finalPrompt = refinedText;
  }

  // Second moderation pass on the LLM-refined prompt — catches cases where the
  // LLM amplified an ambiguous input into something more explicit.
  try {
    await moderateTexts([finalPrompt]);
  } catch (err) {
    if (err instanceof ContentPolicyViolationError) {
      throw new Error(`generation: refined prompt failed content policy — ${err.flaggedCategories.join(", ")}`);
    }
    throw err;
  }

  const image = await ig.generate({ prompt: finalPrompt });

  const { ref, url } = await storeImageAsset({
    services: ctx.services,
    workspaceId: state.workspaceId,
    jobId: state.jobId,
    authorEmail: state.authorEmail,
    bytes: image.bytes,
    mime: image.mime,
    width: image.width,
    height: image.height,
    kind: "ai_generated",
    source: "dalle3",
    origin: { prompt: image.revisedPrompt ?? finalPrompt },
  });

  return {
    rawAsset: ref,
    primaryAssetUrl: url,
    usage: [
      {
        node: "generation",
        provider: image.usage.provider,
        model: image.usage.model,
        imagesGenerated: image.usage.imagesGenerated,
      },
    ],
  };
});
