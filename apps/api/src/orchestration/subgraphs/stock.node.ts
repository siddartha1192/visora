/**
 * FILE: stock.node.ts
 * Workflow 4 — finds a relevant stock photo from Pexels or Unsplash.
 * Mini-pipeline inside this node:
 *  1. GPT extracts 3–6 search keywords from the user's prompt (falls back to naive word split)
 *  2. Searches stock providers in order until results are found (Pexels → Unsplash → stub)
 *  3. Picks the largest image as the best candidate
 *  4. Downloads it and stores to S3 + Asset database record
 */
import type { AssetCandidate } from "@visora/shared";
import { defineNode } from "../context.js";
import { fetchImage } from "../../lib/fetch-image.js";
import { storeImageAsset } from "../asset-helper.js";

/**
 * Workflow 4 — Stock Discovery. Internal pipeline:
 *   keywordExtract (LLM) -> provider.search (Pexels/Unsplash, with fallback)
 *   -> select best candidate -> download -> store as "stock" asset.
 */
export const stockNode = defineNode("stock", async (state, ctx) => {
  const prompt = state.input.prompt;
  if (!prompt) throw new Error("stock: prompt is required");

  // 1) keyword extraction
  let keywords = prompt.split(/\s+/).filter((w) => w.length > 3).slice(0, 5);
  let llmUsage;
  try {
    const { value, usage } = await ctx.services.languageModel.completeJson<{
      keywords: string[];
    }>({
      system:
        "Extract 3-6 concise stock-photo search keywords from the user's idea.",
      user: prompt,
      schemaHint: '{ "keywords": string[] }',
    });
    if (value.keywords?.length) keywords = value.keywords;
    llmUsage = usage;
  } catch {
    /* fall back to naive split */
  }

  // 2) search (primary provider, then fallbacks) until we get candidates
  let candidates: AssetCandidate[] = [];
  for (const provider of ctx.services.stockProviders) {
    candidates = await provider.search({ keywords, limit: 10 }).catch(() => []);
    if (candidates.length) break;
  }
  if (!candidates.length) throw new Error("stock: no candidates found");

  // 3) select — prefer largest; (LLM re-ranking is a later upgrade)
  const best = [...candidates].sort(
    (a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
  )[0];
  if (!best) throw new Error("stock: no candidate selected");

  // 4) download + store
  const img = await fetchImage(best.url);
  const { ref, url } = await storeImageAsset({
    services: ctx.services,
    workspaceId: state.workspaceId,
    jobId: state.jobId,
    bytes: img.bytes,
    mime: img.mime,
    width: best.width ?? 0,
    height: best.height ?? 0,
    kind: "stock",
    source: best.source === "unsplash" ? "unsplash" : "pexels",
    origin: { sourceUrl: best.url, providerMeta: best.providerMeta },
  });

  return {
    candidateAssets: candidates,
    rawAsset: ref,
    primaryAssetUrl: url,
    ...(llmUsage
      ? { usage: [{ node: "stock", provider: llmUsage.provider, model: llmUsage.model }] }
      : {}),
  };
});
