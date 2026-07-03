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

      // Pass as a string so the bundler (esbuild) never transforms it —
      // arrow functions get __name() injected which breaks in the browser context.
      const candidates = await page.evaluate(`(function () {
        var seen = {};
        var out = [];
        function push(src, w, h, alt) {
          if (!src || seen[src] || src.indexOf('data:') === 0) return;
          seen[src] = true;
          out.push({ url: src, width: w || 0, height: h || 0, alt: alt || '' });
        }
        var og = document.querySelector('meta[property="og:image"]');
        if (og) push(og.getAttribute('content'));
        document.querySelectorAll('img').forEach(function (img) {
          push(img.currentSrc || img.src, img.naturalWidth, img.naturalHeight, img.alt);
        });
        return out;
      })()`);

      const typedCandidates = candidates as Array<{ url: string; width: number; height: number; alt: string }>;

      const resolved: AssetCandidate[] = typedCandidates.map((c) => ({
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
