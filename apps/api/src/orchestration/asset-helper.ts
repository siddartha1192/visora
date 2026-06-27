import type { AssetKind, AssetSource, StoredAssetRef } from "@visora/shared";
import { Types } from "mongoose";
import { ulid } from "ulid";
import type { ServiceContainer } from "../config/container.js";
import { AssetModel } from "../db/models/index.js";

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};

/**
 * Stores image bytes in the object store and records an Asset document.
 * Returns a StoredAssetRef (carrying the new assetId) for the graph state, plus
 * a signed URL the optimization node feeds to Cloudinary.
 */
export async function storeImageAsset(args: {
  services: ServiceContainer;
  workspaceId: string;
  jobId: string;
  bytes: Buffer;
  mime: string;
  width: number;
  height: number;
  kind: AssetKind;
  source: AssetSource;
  origin?: { sourceUrl?: string; prompt?: string; providerMeta?: Record<string, unknown> };
}): Promise<{ ref: StoredAssetRef; url: string }> {
  const ext = EXT[args.mime] ?? "png";
  const key = `workspaces/${args.workspaceId}/assets/${ulid()}.${ext}`;

  const stored = await args.services.objectStore.put({
    key,
    body: args.bytes,
    contentType: args.mime,
  });

  const asset = await AssetModel.create({
    workspaceId: new Types.ObjectId(args.workspaceId),
    kind: args.kind,
    origin: { source: args.source, ...args.origin },
    s3: { bucket: stored.bucket, key: stored.s3Key, region: stored.region },
    mime: args.mime,
    width: args.width,
    height: args.height,
    bytes: args.bytes.byteLength,
    createdByJobId: new Types.ObjectId(args.jobId),
  });

  const url = await args.services.objectStore.signedUrl(stored.s3Key, 3600);

  return {
    ref: {
      assetId: asset._id.toHexString(),
      s3Key: stored.s3Key,
      bucket: stored.bucket,
      region: stored.region,
      mime: args.mime,
      width: args.width,
      height: args.height,
      bytes: args.bytes.byteLength,
    },
    url,
  };
}
