import type { Platform } from "@visora/shared";
import { ProviderError } from "../../lib/errors.js";
import { withRetry } from "../../lib/retry.js";
import type { Publisher, PublishParams, PublishResult } from "../interfaces/ports.js";

/**
 * LinkedIn publisher using the current REST API:
 *  1. initializeUpload  → get a one-time upload URL + image URN
 *  2. PUT binary        → upload the image bytes to LinkedIn's storage
 *  3. POST /rest/posts  → create the post referencing the image URN
 *
 * accountId must be a full LinkedIn URN:
 *   Person:       urn:li:person:<id>
 *   Organization: urn:li:organization:<id>
 *
 * Required OAuth scopes: w_member_social (person) or w_organization_social (org)
 */

const BASE      = "https://api.linkedin.com";
const REST_BASE = `${BASE}/rest`;

interface InitUploadResponse {
  value: {
    uploadUrl: string;
    image: string; // e.g. "urn:li:image:C4D..."
  };
}

interface CreatePostResponse {
  id?: string;
}

export class LinkedInPublisher implements Publisher {
  readonly platform: Platform = "linkedin";
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private authHeaders() {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "LinkedIn-Version": "202504",
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
    };
  }

  async publish(params: PublishParams): Promise<PublishResult> {
    try {
      const author = this.toUrn(params.accountId);

      // 1. Initialize the image upload
      const initRes = await withRetry<InitUploadResponse>(
        () =>
          fetch(`${REST_BASE}/images?action=initializeUpload`, {
            method: "POST",
            headers: this.authHeaders(),
            body: JSON.stringify({
              initializeUploadRequest: { owner: author },
            }),
          }).then((r) => r.json() as Promise<InitUploadResponse>),
        { label: "linkedin.initializeUpload" },
      );

      const { uploadUrl, image: imageUrn } = initRes.value;
      if (!uploadUrl || !imageUrn) {
        throw new Error("LinkedIn did not return an upload URL");
      }

      // 2. Fetch the image bytes from our storage URL and upload to LinkedIn
      const imageResponse = await fetch(params.imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image for LinkedIn upload: ${imageResponse.status}`);
      }
      const imageBytes = await imageResponse.arrayBuffer();

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: imageBytes,
      });
      if (!uploadRes.ok) {
        throw new Error(`LinkedIn image upload failed: ${uploadRes.status}`);
      }

      // 3. Create the post referencing the uploaded image URN
      const postBody = {
        author,
        commentary: params.caption,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: {
          media: {
            title: "Image",
            id: imageUrn,
          },
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      };

      const createRes = await withRetry<CreatePostResponse>(
        () =>
          fetch(`${REST_BASE}/posts`, {
            method: "POST",
            headers: this.authHeaders(),
            body: JSON.stringify(postBody),
          }).then(async (r) => {
            // LinkedIn returns 201 with the post URN in the `x-restli-id` header
            if (r.status === 201) {
              const postId = r.headers.get("x-restli-id") ?? "";
              return { id: postId };
            }
            const body = await r.json();
            throw new Error(
              (body as { message?: string }).message ?? `LinkedIn post creation failed: ${r.status}`,
            );
          }),
        { label: "linkedin.createPost" },
      );

      const postId = createRes.id ?? imageUrn;
      const encodedId = encodeURIComponent(postId);

      return {
        externalPostId: postId,
        permalink: `https://www.linkedin.com/feed/update/${encodedId}/`,
      };
    } catch (err) {
      throw new ProviderError("linkedin", (err as Error).message);
    }
  }

  /** Ensures the accountId is a valid LinkedIn URN. */
  private toUrn(accountId: string): string {
    if (accountId.startsWith("urn:li:")) return accountId;
    // Default to person URN if no prefix given
    return `urn:li:person:${accountId}`;
  }
}
