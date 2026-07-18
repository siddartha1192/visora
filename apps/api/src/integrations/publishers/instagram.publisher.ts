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
  error?: { message: string; code?: number };
}

export class InstagramPublisher implements Publisher {
  readonly platform: Platform = "instagram";
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async publish(params: PublishParams): Promise<PublishResult> {
    try {
      // Step 1: create a media container (Instagram stages it before publishing).
      // Parameters are sent as a form-encoded POST body — safer than query strings
      // for long captions containing emojis, hashtags, and special characters.
      const containerRes = await withRetry<GraphResponse>(
        () =>
          fetch(`${BASE}/${params.accountId}/media`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              image_url: params.imageUrl,
              caption: params.caption,
              access_token: this.accessToken,
            }).toString(),
          }).then((r) => r.json() as Promise<GraphResponse>),
        { label: "instagram.media.create" },
      );
      if (!containerRes.id) {
        throw new Error(
          containerRes.error?.message ?? "no container id returned",
        );
      }

      // Step 2: publish the staged container
      const publishRes = await withRetry<GraphResponse>(
        () =>
          fetch(`${BASE}/${params.accountId}/media_publish`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              creation_id: containerRes.id!,
              access_token: this.accessToken,
            }).toString(),
          }).then((r) => r.json() as Promise<GraphResponse>),
        { label: "instagram.media.publish" },
      );
      if (!publishRes.id) {
        throw new Error(publishRes.error?.message ?? "publish failed");
      }

      return {
        externalPostId: publishRes.id,
        permalink: `https://www.instagram.com/p/${publishRes.id}/`,
      };
    } catch (err) {
      throw new ProviderError("instagram", (err as Error).message);
    }
  }
}
