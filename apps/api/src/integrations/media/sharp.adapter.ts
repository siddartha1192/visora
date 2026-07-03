import sharp, { type FitEnum } from "sharp";
import type { PlatformImageSpec, StoredAssetRef } from "@visora/shared";
import { logger } from "../../lib/logger.js";
import { ProviderError } from "../../lib/errors.js";
import type { MediaOptimizer, ObjectStore, PutObjectParams, ResizeResult } from "../interfaces/ports.js";

const CROP_FIT: Record<string, keyof FitEnum> = {
  fill: "cover",
  fit:  "contain",
  pad:  "inside",
};

/**
 * Local/S3-backed media optimizer using sharp (no external service required).
 * Resizes the source image to each platform's target dimensions and uploads
 * the variant back to the object store. In local dev the file lands on disk;
 * in production it goes to S3 — same ObjectStore interface either way.
 */
export class SharpMediaOptimizer implements MediaOptimizer {
  readonly name = "sharp";

  constructor(private readonly objectStore: ObjectStore) {}

  async resizeForPlatform(args: {
    source: StoredAssetRef;
    sourceUrl: string;
    spec: PlatformImageSpec;
  }): Promise<ResizeResult> {
    const { source, spec } = args;

    logger.info(
      { platform: spec.platform, width: spec.width, height: spec.height, sourceKey: source.s3Key },
      "sharp: resizing image for platform",
    );

    let srcBytes: Buffer;
    try {
      const { body } = await this.objectStore.get(source.s3Key);
      srcBytes = body;
    } catch {
      // Fallback: fetch from URL (e.g. when source is a stock photo URL not yet in store)
      logger.debug({ key: source.s3Key }, "sharp: key not in store, fetching from sourceUrl");
      const res = await fetch(args.sourceUrl);
      if (!res.ok) throw new ProviderError("sharp", `Failed to fetch source image: ${res.status}`);
      srcBytes = Buffer.from(await res.arrayBuffer());
    }

    const fit: keyof FitEnum = CROP_FIT[spec.crop] ?? "cover";
    const resized = await sharp(srcBytes)
      .resize(spec.width, spec.height, { fit, position: "attention" })
      .webp({ quality: 85 })
      .toBuffer();

    const variantKey = `variants/${spec.platform}/${source.s3Key.replace(/\.[^.]+$/, "")}.webp`;
    const putParams: PutObjectParams = {
      key: variantKey,
      body: resized,
      contentType: "image/webp",
    };
    const stored = await this.objectStore.put(putParams);
    const variantUrl = await this.objectStore.signedUrl(stored.s3Key);

    logger.info(
      { platform: spec.platform, width: spec.width, height: spec.height, variantKey: stored.s3Key, bytes: resized.byteLength },
      "sharp: variant ready",
    );

    return {
      platform: spec.platform,
      cloudinaryUrl: variantUrl, // field name is legacy; this is the delivery URL regardless of store
      s3Key: stored.s3Key,
      width: spec.width,
      height: spec.height,
      aspectRatio: spec.aspectRatio,
    };
  }
}
