import type { ScrapeResult, WebScraper } from "../interfaces/ports.js";

/**
 * Offline scraper used when Playwright/browser binaries are unavailable (e.g.
 * CI without `playwright install`). Returns a deterministic candidate derived
 * from the URL host so the scrape workflow completes end-to-end.
 */
export class StubScraper implements WebScraper {
  readonly name = "stub";

  async extractImages(url: string): Promise<ScrapeResult> {
    let host = "example";
    try {
      host = new URL(url).hostname;
    } catch {
      /* keep default */
    }
    return {
      pageTitle: `Stub scrape of ${host}`,
      candidates: [
        {
          url: `https://picsum.photos/seed/${encodeURIComponent(host)}/1200/1200`,
          thumbnailUrl: `https://picsum.photos/seed/${encodeURIComponent(host)}/300/300`,
          width: 1200,
          height: 1200,
          source: "scrape",
          providerMeta: { pageUrl: url, stub: true },
        },
      ],
    };
  }
}
