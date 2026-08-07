import type { PlatformImageSpec, StoredAssetRef } from "@visora/shared";
import type { MediaOptimizer, ResizeResult } from "../interfaces/ports.js";

/**
 * Offline optimizer: echoes the source URL and records the intended target
 * dimensions so the pipeline produces well-formed variants without Cloudinary.
 */
export class StubMediaOptimizer implements MediaOptimizer {
  readonly name = "stub";

  async resizeForPlatform(args: {
    sourceUrl: string;
    spec: PlatformImageSpec;
    source: StoredAssetRef;
  }): Promise<ResizeResult> {
    const { spec, sourceUrl, source } = args;
    return {
      platform: spec.platform,
      cloudinaryUrl: `${sourceUrl}#${spec.width}x${spec.height}`,
      s3Key: source.s3Key,
      width: spec.width,
      height: spec.height,
      aspectRatio: spec.aspectRatio,
    };
  }
}
