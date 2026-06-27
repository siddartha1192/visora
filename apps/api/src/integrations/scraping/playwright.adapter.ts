import { chromium } from "playwright";
import type { AssetCandidate } from "@visora/shared";
import { ProviderError } from "../../lib/errors.js";
import type { ScrapeResult, WebScraper } from "../interfaces/ports.js";

/**
 * Renders the target URL in headless Chromium and harvests <img> + og:image
 * assets. Rendering (vs. static HTML parse) catches lazy-loaded and JS-injected
 * images. The graph's scraping subgraph then LLM-filters these by context.
 */
export class PlaywrightScraper implements WebScraper {
  readonly name = "playwright";

  async extractImages(url: string): Promise<ScrapeResult> {
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({
        userAgent:
          "Mozilla/5.0 (compatible; VisoraBot/1.0; +https://visora.app/bot)",
      });
      await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
      const pageTitle = await page.title();

      const candidates = await page.evaluate(() => {
        // Runs in the browser context; `document` is provided by the page.
        const doc = (globalThis as unknown as { document: any }).document;
        const seen = new Set<string>();
        const out: Array<{ url: string; width: number; height: number; alt: string }> = [];
        const push = (src: string | null, w = 0, h = 0, alt = "") => {
          if (!src || seen.has(src) || src.startsWith("data:")) return;
          seen.add(src);
          out.push({ url: src, width: w, height: h, alt });
        };
        const og = doc.querySelector('meta[property="og:image"]');
        push(og?.getAttribute("content") ?? null);
        doc.querySelectorAll("img").forEach((img: any) => {
          push(img.currentSrc || img.src, img.naturalWidth, img.naturalHeight, img.alt);
        });
        return out as Array<{ url: string; width: number; height: number; alt: string }>;
      });

      const resolved: AssetCandidate[] = candidates.map((c) => ({
        url: new URL(c.url, url).toString(),
        width: c.width,
        height: c.height,
        source: "scrape",
        providerMeta: { alt: c.alt, pageUrl: url },
      }));

      return { candidates: resolved, pageTitle };
    } catch (err) {
      throw new ProviderError("playwright", (err as Error).message);
    } finally {
      await browser?.close();
    }
  }
}
