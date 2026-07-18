import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { ASSET_KINDS, ASSET_SOURCES, PLATFORMS } from "@visora/shared";

const variantSchema = new Schema(
  {
    platform: { type: String, enum: PLATFORMS, required: true },
    aspectRatio: { type: String, required: true },
    cloudinaryUrl: { type: String, required: true },
    s3Key: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { _id: true },
);

const assetSchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    kind: { type: String, enum: ASSET_KINDS, required: true },
    origin: {
      source: { type: String, enum: ASSET_SOURCES, required: true },
      sourceUrl: { type: String },
      prompt: { type: String },
      providerMeta: { type: Schema.Types.Mixed },
    },
    s3: {
      bucket: { type: String, required: true },
      key: { type: String, required: true },
      region: { type: String, required: true },
    },
    mime: { type: String, required: true },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    bytes: { type: Number, default: 0 },
    checksum: { type: String },
    variants: { type: [variantSchema], default: [] },
    createdByJobId: { type: Schema.Types.ObjectId, ref: "Job" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

assetSchema.index({ workspaceId: 1, kind: 1 });

export type AssetDoc = InferSchemaType<typeof assetSchema> & {
  _id: Types.ObjectId;
};

export const AssetModel = model("Asset", assetSchema);
