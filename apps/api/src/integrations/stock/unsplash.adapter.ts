import type { AssetCandidate } from "@visora/shared";
import { env } from "../../config/env.js";
import { ProviderError } from "../../lib/errors.js";
import { withRetry } from "../../lib/retry.js";
import type { StockProvider, StockSearchParams } from "../interfaces/ports.js";

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  urls: { raw: string; full: string; regular: string; small: string };
  links: { html: string };
  alt_description: string | null;
}

export class UnsplashStockProvider implements StockProvider {
  readonly name = "unsplash";

  async search(params: StockSearchParams): Promise<AssetCandidate[]> {
    const query = params.keywords.join(" ");
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(
      query,
    )}&per_page=${params.limit}`;
    try {
      const res = await withRetry(
        () =>
          fetch(url, {
            headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY ?? ""}` },
          }),
        { label: "unsplash.search" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { results: UnsplashPhoto[] };
      return json.results.map((p) => ({
        url: p.urls.full,
        thumbnailUrl: p.urls.small,
        width: p.width,
        height: p.height,
        source: "unsplash",
        providerMeta: {
          id: p.id,
          alt: p.alt_description,
          sourceUrl: p.links.html,
        },
      }));
    } catch (err) {
      throw new ProviderError("unsplash", (err as Error).message);
    }
  }
}
