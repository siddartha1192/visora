/**
 * FILE: scraping.node.ts
 * Workflow 5 — extracts the best image from a web page URL using a headless browser.
 * Mini-pipeline inside this node:
 *  1. Playwright renders the page and extracts all <img> and og:image candidates
 *  2. GPT picks the most contextually relevant image from the list (falls back to largest)
 *  3. Downloads the chosen image and stores to S3 + Asset database record
 */
import { defineNode } from "../context.js";
import { fetchImage } from "../../lib/fetch-image.js";
import { storeImageAsset } from "../asset-helper.js";

/**
 * Workflow 5 — Web Scraper Extraction. Internal pipeline:
 *   fetch+render (Playwright) -> extract <img>/og:image -> LLM filter by context
 *   -> pick best -> download -> store as "scraped" asset.
 */
export const scrapingNode = defineNode("scraping", async (state, ctx) => {
  const sourceUrl = state.input.sourceUrl;
  const context = state.input.context ?? "";
  if (!sourceUrl) throw new Error("scraping: sourceUrl is required");

  const { candidates } = await ctx.services.scraper.extractImages(sourceUrl);
  const usable = candidates.filter((c) => /^https?:/.test(c.url));
  if (!usable.length) throw new Error("scraping: no images found on page");

  // LLM-assisted selection by context; falls back to largest image.
  let chosen = [...usable].sort(
    (a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
  )[0]!;
  let llmUsage;
  try {
    const list = usable
      .slice(0, 15)
      .map((c, i) => `${i}: ${c.url} (${c.providerMeta?.alt ?? "no alt"})`)
      .join("\n");
    const { value, usage } = await ctx.services.languageModel.completeJson<{
      index: number;
    }>({
      system:
        "Given a list of candidate images and a desired context, choose the single most relevant by index.",
      user: `Context: ${context}\n\nCandidates:\n${list}`,
      schemaHint: '{ "index": number }',
    });
    if (usable[value.index]) chosen = usable[value.index]!;
    llmUsage = usage;
  } catch {
    /* keep largest-image fallback */
  }

  const img = await fetchImage(chosen.url);
  const { ref, url } = await storeImageAsset({
    services: ctx.services,
    workspaceId: state.workspaceId,
    jobId: state.jobId,
    bytes: img.bytes,
    mime: img.mime,
    width: chosen.width ?? 0,
    height: chosen.height ?? 0,
    kind: "scraped",
    source: "scrape",
    origin: { sourceUrl, providerMeta: chosen.providerMeta },
  });

  return {
    candidateAssets: usable,
    processedAsset: ref,
    primaryAssetUrl: url,
    ...(llmUsage
      ? { usage: [{ node: "scraping", provider: llmUsage.provider, model: llmUsage.model }] }
      : {}),
  };
});
