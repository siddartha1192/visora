import type { Platform } from "./enums.js";

/**
 * Per-platform image specifications used by the Optimization node to drive
 * Cloudinary transformations. Dimensions follow each network's recommended
 * feed-post sizes (single image). Extend with story/reel specs in later phases.
 */
export interface PlatformImageSpec {
  platform: Platform;
  /** Human label for the variant. */
  label: string;
  /** Target aspect ratio expressed as "w:h". */
  aspectRatio: string;
  width: number;
  height: number;
  /** Cloudinary crop strategy. */
  crop: "fill" | "fit" | "pad";
  /** Hard caps the network enforces. */
  maxBytes: number;
  allowedFormats: Array<"jpg" | "png" | "webp">;
}

export const PLATFORM_IMAGE_SPECS: Record<Platform, PlatformImageSpec> = {
  instagram: {
    platform: "instagram",
    label: "Instagram Feed (Square)",
    aspectRatio: "1:1",
    width: 1080,
    height: 1080,
    crop: "fill",
    maxBytes: 8 * 1024 * 1024,
    allowedFormats: ["jpg", "png"],
  },
  facebook: {
    platform: "facebook",
    label: "Facebook Feed",
    aspectRatio: "1.91:1",
    width: 1200,
    height: 630,
    crop: "fill",
    maxBytes: 8 * 1024 * 1024,
    allowedFormats: ["jpg", "png"],
  },
  x: {
    platform: "x",
    label: "X (Twitter) Post",
    aspectRatio: "16:9",
    width: 1600,
    height: 900,
    crop: "fill",
    maxBytes: 5 * 1024 * 1024,
    allowedFormats: ["jpg", "png", "webp"],
  },
  linkedin: {
    platform: "linkedin",
    label: "LinkedIn Post",
    aspectRatio: "1.91:1",
    width: 1200,
    height: 627,
    crop: "fill",
    maxBytes: 8 * 1024 * 1024,
    allowedFormats: ["jpg", "png"],
  },
};

export const DEFAULT_PLATFORM_SPEC = PLATFORM_IMAGE_SPECS.instagram;
