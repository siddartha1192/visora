import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import {
  PLATFORMS,
  POST_STATUSES,
  SCHEDULE_MODES,
  TARGET_STATUSES,
  WORKFLOWS,
} from "@visora/shared";

const targetSchema = new Schema(
  {
    platform: { type: String, enum: PLATFORMS, required: true },
    accountId: { type: String, required: true },
    assetVariantId: { type: Schema.Types.ObjectId },
    status: { type: String, enum: TARGET_STATUSES, default: "pending" },
    externalPostId: { type: String },
    permalink: { type: String },
    error: { type: String },
  },
  { _id: false },
);

const postSchema = new Schema(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    workflow: { type: String, enum: WORKFLOWS, required: true },
    status: {
      type: String,
      enum: POST_STATUSES,
      default: "draft",
      index: true,
    },
    input: {
      brief: { type: String },
      prompt: { type: String },
      instructions: { type: String },
      sourceUrl: { type: String },
      uploadedAssetId: { type: Schema.Types.ObjectId, ref: "Asset" },
      context: { type: String },
      stockSource: { type: String, enum: ["auto", "pexels", "unsplash"] },
      enhanceAfterStock: { type: Boolean },
      enhanceInstructions: { type: String },
    },
    caption: {
      text: { type: String, default: "" },
      hashtags: { type: [String], default: [] },
      generated: { type: Boolean, default: false },
    },
    targets: { type: [targetSchema], default: [] },
    primaryAssetId: { type: Schema.Types.ObjectId, ref: "Asset" },
    schedule: {
      mode: { type: String, enum: SCHEDULE_MODES, default: "instant" },
      runAt: { type: Date },
      timezone: { type: String, default: "UTC" },
      publishedAt: { type: Date },
    },
    jobId: { type: Schema.Types.ObjectId, ref: "Job" },
    lastError: { type: String },
  },
  { timestamps: true },
);

// Scheduler/worker hot path: find due posts by workspace + status + runAt.
postSchema.index({ workspaceId: 1, status: 1, "schedule.runAt": 1 });

export type PostDoc = InferSchemaType<typeof postSchema> & {
  _id: Types.ObjectId;
};

export const PostModel = model("Post", postSchema);
