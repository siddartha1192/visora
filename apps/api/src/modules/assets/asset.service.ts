import type { AssetDTO } from "@visora/shared";
import { Types } from "mongoose";
import { ulid } from "ulid";
import { createContainer } from "../../config/container.js";
import { AssetModel, type AssetDoc } from "../../db/models/index.js";
import { NotFoundError } from "../../lib/errors.js";

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Handles direct user uploads: stores bytes in the object store and records an
 * Asset (kind "upload"). The passthrough + enhance workflows reference these by
 * id. The HTTP layer streams multipart bytes here.
 */
export async function uploadAsset(args: {
  workspaceId: string;
  bytes: Buffer;
  mime: string;
}): Promise<AssetDTO> {
  const services = createContainer();
  const ext = EXT[args.mime] ?? "bin";
  const key = `workspaces/${args.workspaceId}/uploads/${ulid()}.${ext}`;

  const stored = await services.objectStore.put({
    key,
    body: args.bytes,
    contentType: args.mime,
  });

  const asset = await AssetModel.create({
    workspaceId: new Types.ObjectId(args.workspaceId),
    kind: "upload",
    origin: { source: "user" },
    s3: { bucket: stored.bucket, key: stored.s3Key, region: stored.region },
    mime: args.mime,
    bytes: args.bytes.byteLength,
  });

  return toAssetDTO(asset, await services.objectStore.signedUrl(key));
}

export async function getAsset(
  workspaceId: string,
  assetId: string,
): Promise<AssetDTO> {
  const asset = await AssetModel.findOne({
    _id: new Types.ObjectId(assetId),
    workspaceId: new Types.ObjectId(workspaceId),
  });
  if (!asset?.s3) throw new NotFoundError("Asset");
  const services = createContainer();
  return toAssetDTO(asset, await services.objectStore.signedUrl(asset.s3.key));
}

function toAssetDTO(asset: AssetDoc, url: string): AssetDTO {
  return {
    id: asset._id.toString(),
    workspaceId: asset.workspaceId.toString(),
    kind: asset.kind,
    origin: {
      source: asset.origin?.source ?? "user",
      sourceUrl: asset.origin?.sourceUrl ?? undefined,
      prompt: asset.origin?.prompt ?? undefined,
      providerMeta: asset.origin?.providerMeta as Record<string, unknown> | undefined,
    },
    s3: {
      bucket: asset.s3?.bucket ?? "",
      key: asset.s3?.key ?? "",
      region: asset.s3?.region ?? "",
    },
    url,
    mime: asset.mime,
    width: asset.width,
    height: asset.height,
    bytes: asset.bytes,
    checksum: asset.checksum ?? undefined,
    variants: asset.variants.map((v) => ({
      platform: v.platform,
      aspectRatio: v.aspectRatio,
      cloudinaryUrl: v.cloudinaryUrl,
      s3Key: v.s3Key,
      width: v.width,
      height: v.height,
    })),
    createdByJobId: asset.createdByJobId?.toString(),
    createdAt: (asset as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}
