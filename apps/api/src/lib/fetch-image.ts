import { ProviderError } from "./errors.js";
import { withRetry } from "./retry.js";

export interface FetchedImage {
  bytes: Buffer;
  mime: string;
}

/** Downloads a remote image to a Buffer, validating it is actually an image. */
export async function fetchImage(url: string): Promise<FetchedImage> {
  return withRetry(
    async () => {
      const res = await fetch(url);
      if (!res.ok) throw new ProviderError("fetch", `HTTP ${res.status} for ${url}`);
      const mime = res.headers.get("content-type") ?? "image/jpeg";
      if (!mime.startsWith("image/")) {
        throw new ProviderError("fetch", `not an image (${mime}) at ${url}`);
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      return { bytes, mime };
    },
    { label: "fetchImage" },
  );
}
