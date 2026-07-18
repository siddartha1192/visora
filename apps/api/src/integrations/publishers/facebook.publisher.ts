import type { Platform } from "@visora/shared";
import { ProviderError } from "../../lib/errors.js";
import { withRetry } from "../../lib/retry.js";
import type {
  Publisher,
  PublishParams,
  PublishResult,
} from "../interfaces/ports.js";

const BASE = "https://graph.facebook.com/v21.0";

interface GraphResponse {
  id?: string;
  post_id?: string;
  error?: { message: string; code?: number };
}

/**
 * Publishes a photo + caption to a Facebook Page via the Graph API.
 * `params.accountId` must be the Facebook Page ID (e.g. "965381603325389").
 * Uses a public image URL (S3 / Cloudinary) rather than a local file upload.
 */
export class FacebookPublisher implements Publisher {
  readonly platform: Platform = "facebook";

  constructor(private readonly accessToken: string) {}

  async publish(params: PublishParams): Promise<PublishResult> {
    try {
      const res = await withRetry<GraphResponse>(
        () =>
          fetch(`${BASE}/${params.accountId}/photos`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              url: params.imageUrl,
              message: params.caption,
              access_token: this.accessToken,
            }).toString(),
          }).then((r) => r.json() as Promise<GraphResponse>),
        { label: "facebook.photos.post", retries: 2, baseDelayMs: 1500, maxDelayMs: 12000 },
      );

      // Graph API returns either `post_id` (preferred) or `id` for photo posts
      const postId = res.post_id ?? res.id;
      if (!postId) {
        throw new Error(res.error?.message ?? "no post id returned");
      }

      return {
        externalPostId: postId,
        permalink: `https://www.facebook.com/${postId}`,
      };
    } catch (err) {
      throw new ProviderError("facebook", (err as Error).message);
    }
  }
}
