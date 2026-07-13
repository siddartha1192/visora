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

/**
 * Workflow 2 — Pure AI Generation. Internally a mini-pipeline:
 *   promptRefine (LLM) -> DALL·E 3 generate -> store to object store + Asset.
 * The refined prompt step is best-effort; failure falls back to the raw prompt.
 */
export const generationNode = defineNode("generation", async (state, ctx) => {
  const prompt = state.input.prompt;
  if (!prompt) throw new Error("generation: prompt is required");

  let finalPrompt = prompt;
  const nodeAdapters = ctx.nodeAdapters?.generation;
  const lm = nodeAdapters?.languageModel ?? ctx.services.languageModel;
  const ig = nodeAdapters?.imageGenerator ?? ctx.services.imageGenerator;
  try {
    const refined = await lm.complete({
      system:
        "Rewrite the user's idea into a vivid, detailed image-generation prompt. Return only the prompt.",
      user: prompt,
    });
    if (refined.text.trim()) finalPrompt = refined.text.trim();
  } catch {
    /* fall back to raw prompt */
  }

  const image = await ig.generate({ prompt: finalPrompt });

  const { ref, url } = await storeImageAsset({
    services: ctx.services,
    workspaceId: state.workspaceId,
    jobId: state.jobId,
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
