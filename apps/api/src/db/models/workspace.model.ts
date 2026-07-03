import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { PLATFORMS } from "@visora/shared";

const apiKeySchema = new Schema(
  {
    keyId: { type: String, required: true },
    hashedKey: { type: String, required: true },
    label: { type: String, required: true },
    scopes: { type: [String], default: ["posts:write"] },
    lastUsedAt: { type: Date },
    revoked: { type: Boolean, default: false },
  },
  { _id: false },
);

const socialAccountSchema = new Schema(
  {
    platform: { type: String, enum: PLATFORMS, required: true },
    handle: { type: String, required: true },
    externalAccountId: { type: String, required: true },
    /** Pointer/reference to the secret store entry — never the raw token. */
    accessTokenRef: { type: String },
    tokenExpiresAt: { type: Date },
    status: {
      type: String,
      enum: ["connected", "expired", "revoked"],
      default: "connected",
    },
  },
  { timestamps: true },
);

const workspaceSchema = new Schema(
  {
    name: { type: String, required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    apiKeys: { type: [apiKeySchema], default: [] },
    socialAccounts: { type: [socialAccountSchema], default: [] },
    plan: { type: String, default: "free" },
    creditBalance: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type WorkspaceDoc = InferSchemaType<typeof workspaceSchema> & {
  _id: Types.ObjectId;
};

export const WorkspaceModel = model("Workspace", workspaceSchema);
