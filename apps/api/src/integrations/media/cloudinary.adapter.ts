import { v2 as cloudinary } from "cloudinary";
import { env } from "../../config/env.js";
import { ProviderError } from "../../lib/errors.js";
import { withRetry } from "../../lib/retry.js";
import type { MediaOptimizer, ResizeResult } from "../interfaces/ports.js";

/**
 * Uploads the source image to Cloudinary and derives a platform-tailored,
 * auto-optimized rendition (correct aspect ratio, format, quality). The derived
 * URL is what the Publish node hands to each social network.
 */
export class CloudinaryOptimizer implements MediaOptimizer {
  readonly name = "cloudinary";

  constructor() {
    if (env.CLOUDINARY_URL) {
      // SDK auto-parses CLOUDINARY_URL from env.
      cloudinary.config({ secure: true });
    } else {
      cloudinary.config({
        cloud_name: env.CLOUDINARY_CLOUD_NAME,
        api_key: env.CLOUDINARY_API_KEY,
        api_secret: env.CLOUDINARY_API_SECRET,
        secure: true,
      });
    }
  }

  async resizeForPlatform(args: {
    sourceUrl: string;
    spec: import("@visora/shared").PlatformImageSpec;
    source: import("@visora/shared").StoredAssetRef;
  }): Promise<ResizeResult> {
    const { spec, sourceUrl } = args;
    try {
      const uploaded = await withRetry(
        () => cloudinary.uploader.upload(sourceUrl, {
          folder: `visora/${spec.platform}`,
          resource_type: "image",
        }),
        { label: "cloudinary.upload", retries: 3, baseDelayMs: 1000, maxDelayMs: 10000 },
      );
      const url = cloudinary.url(uploaded.public_id, {
        width: spec.width,
        height: spec.height,
        crop: spec.crop,
        gravity: "auto",
        quality: "auto",
        fetch_format: "auto",
        secure: true,
      });
      return {
        platform: spec.platform,
        cloudinaryUrl: url,
        s3Key: args.source.s3Key,
        width: spec.width,
        height: spec.height,
        aspectRatio: spec.aspectRatio,
      };
    } catch (err) {
      throw new ProviderError("cloudinary", (err as Error).message);
    }
  }
}
