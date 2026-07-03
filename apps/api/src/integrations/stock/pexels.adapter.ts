import type { AssetCandidate } from "@visora/shared";
import { env } from "../../config/env.js";
import { ProviderError } from "../../lib/errors.js";
import { withRetry } from "../../lib/retry.js";
import type { StockProvider, StockSearchParams } from "../interfaces/ports.js";

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  src: { original: string; large2x: string; medium: string };
  alt: string;
}

export class PexelsStockProvider implements StockProvider {
  readonly name = "pexels";

  async search(params: StockSearchParams): Promise<AssetCandidate[]> {
    const query = params.keywords.join(" ");
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(
      query,
    )}&per_page=${params.limit}`;
    try {
      const res = await withRetry(
        () =>
          fetch(url, {
            headers: { Authorization: env.PEXELS_API_KEY ?? "" },
          }),
        { label: "pexels.search" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { photos: PexelsPhoto[] };
      return json.photos.map((p) => ({
        url: p.src.original,
        thumbnailUrl: p.src.medium,
        width: p.width,
        height: p.height,
        source: "pexels",
        providerMeta: { id: p.id, alt: p.alt, sourceUrl: p.url },
      }));
    } catch (err) {
      throw new ProviderError("pexels", (err as Error).message);
    }
  }
}
