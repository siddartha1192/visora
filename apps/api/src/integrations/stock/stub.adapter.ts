import type { AssetCandidate } from "@visora/shared";
import type { StockProvider, StockSearchParams } from "../interfaces/ports.js";

/**
 * Offline stock provider: returns deterministic placeholder candidates keyed by
 * the search terms (via picsum.photos seeds) so the discovery + selection steps
 * run without a Pexels/Unsplash key.
 */
export class StubStockProvider implements StockProvider {
  readonly name = "stub";

  async search(params: StockSearchParams): Promise<AssetCandidate[]> {
    const seed = params.keywords.join("-") || "visora";
    return Array.from({ length: Math.min(params.limit, 6) }, (_, i) => ({
      url: `https://picsum.photos/seed/${encodeURIComponent(seed)}-${i}/1200/1200`,
      thumbnailUrl: `https://picsum.photos/seed/${encodeURIComponent(seed)}-${i}/300/300`,
      width: 1200,
      height: 1200,
      source: "stub",
      providerMeta: { seed, index: i },
    }));
  }
}
