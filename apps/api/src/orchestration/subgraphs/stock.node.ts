/**
 * FILE: stock.node.ts
 * Workflow 4 — finds a relevant stock photo from Pexels or Unsplash.
 * Mini-pipeline inside this node:
 *  1. GPT extracts 3–6 search keywords from the user's prompt (falls back to naive word split)
 *  2. Searches the chosen provider (or Pexels → Unsplash → stub if "auto")
 *  3. Picks the largest image as the best candidate
 *  4. Downloads it and stores as a "stock" asset
 *  5. Optionally runs AI enhancement on the downloaded image (enhanceAfterStock=true)
 */
import type { AssetCandidate, AssetKind, AssetSource, UsageRecord } from "@visora/shared";
import { defineNode } from "../context.js";
import { fetchImage } from "../../lib/fetch-image.js";
import { storeImageAsset } from "../asset-helper.js";

export const stockNode = defineNode("stock", async (state, ctx) => {
  const prompt = state.input.prompt;
  if (!prompt) throw new Error("stock: prompt is required");

  // 1) keyword extraction via LLM, fall back to naive word split
  let keywords = prompt.split(/\s+/).filter((w) => w.length > 3).slice(0, 5);
  let llmUsage;
  try {
    const { value, usage } = await ctx.services.languageModel.completeJson<{
      keywords: string[];
    }>({
      system: "Extract 3-6 concise stock-photo search keywords from the user's idea.",
      user: prompt,
      schemaHint: '{ "keywords": string[] }',
    });
    if (value.keywords?.length) keywords = value.keywords;
    llmUsage = usage;
  } catch {
    /* fall back to naive split */
  }

  // 2) build provider list based on stockSource preference
  const preference = state.input.stockSource ?? "auto";
  let providers = ctx.services.stockProviders;
  if (preference !== "auto") {
    const pinned = providers.find((p) => p.name === preference);
    if (!pinned) {
      // User explicitly requested a provider that has no API key configured.
      // Fail clearly rather than silently using a different provider.
      throw new Error(
        `stock: "${preference}" provider is not configured — add ${preference === "pexels" ? "PEXELS_API_KEY" : "UNSPLASH_ACCESS_KEY"} to your environment`,
      );
    }
    providers = [pinned];
  }

  let candidates: AssetCandidate[] = [];
  for (const provider of providers) {
    candidates = await provider.search({ keywords, limit: 10 }).catch(() => []);
    if (candidates.length) break;
  }
  if (!candidates.length) {
    const providerNames = providers.map((p) => p.name).join(", ");
    throw new Error(`stock: no photos found for "${keywords.join(", ")}" on [${providerNames}]`);
  }

  // 3) select — prefer largest resolution
  const best = [...candidates].sort(
    (a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
  )[0];
  if (!best) throw new Error("stock: no candidate selected");

  // 4) download original
  const img = await fetchImage(best.url);

  const stockSource: AssetSource =
    best.source === "unsplash" ? "unsplash" :
    best.source === "pexels"   ? "pexels"   :
    "pexels"; // stub/unknown — dev-only fallback, real providers always set their name

  // 5) optional AI enhancement
  const shouldEnhance = state.input.enhanceAfterStock === true;
  let finalBytes = img.bytes;
  let finalMime = img.mime;
  let finalKind: AssetKind = "stock";
  let finalSource: AssetSource = stockSource;
  let enhanceUsage;

  if (shouldEnhance) {
    const instructions =
      state.input.enhanceInstructions?.trim() ||
      "Enhance this photo for social media: improve lighting, color grading, contrast, and visual impact while keeping the subject natural.";

    const enhanced = await ctx.services.imageGenerator.edit({
      source: img.bytes,
      sourceMime: img.mime,
      instructions,
    });
    finalBytes = enhanced.bytes;
    finalMime = enhanced.mime;
    finalKind = "enhanced";
    finalSource = "dalle3";
    enhanceUsage = enhanced.usage;
  }

  // 6) store final asset
  const { ref, url } = await storeImageAsset({
    services: ctx.services,
    workspaceId: state.workspaceId,
    jobId: state.jobId,
    bytes: finalBytes,
    mime: finalMime,
    width: best.width ?? 0,
    height: best.height ?? 0,
    kind: finalKind,
    source: finalSource,
    origin: {
      sourceUrl: best.url,
      prompt: shouldEnhance ? state.input.enhanceInstructions ?? undefined : undefined,
      providerMeta: { ...best.providerMeta, originalSource: stockSource },
    },
  });

  const usageRecords: UsageRecord[] = [];
  if (llmUsage) usageRecords.push({ node: "stock", provider: llmUsage.provider, model: llmUsage.model });
  if (enhanceUsage) usageRecords.push({ node: "stock", provider: enhanceUsage.provider, model: enhanceUsage.model });

  return {
    candidateAssets: candidates,
    rawAsset: ref,
    primaryAssetUrl: url,
    ...(usageRecords.length ? { usage: usageRecords } : {}),
  };
});
