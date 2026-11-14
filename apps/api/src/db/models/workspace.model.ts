import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { PLATFORMS } from "@visora/shared";

const apiKeySchema = new Schema(
  {
    keyId: { type: String, required: true },
    hashedKey: { type: String, required: true },
    label: { type: String, required: true },
    scopes: { type: [String], default: ["posts:write"] },
    expiresAt: { type: Date, default: null },
    lastUsedAt: { type: Date },
    revoked: { type: Boolean, default: false },
    revokedAt: { type: Date, default: null },
    /** Who pulled the trigger — the key's own owner (self-service) or an admin/root (oversight). */
    revokedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false, timestamps: true },
);

const socialAccountSchema = new Schema(
  {
    platform: { type: String, enum: PLATFORMS, required: true },
    handle: { type: String, required: true },
    externalAccountId: { type: String, required: true },
    /**
     * Phase 2 placeholder mechanism: the *name* of an env var holding the
     * operator's own token. Superseded by encryptedAccessToken for a real
     * per-workspace connection (see social-oauth.service.ts) — kept for
     * backward compatibility with any workspace still using the fallback.
     */
    accessTokenRef: { type: String },
    /** AES-256-GCM ciphertext (lib/crypto.ts) of a real, customer-owned OAuth token. Never the raw token. */
    encryptedAccessToken: { type: String },
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
    /**
     * The tenant this workspace belongs to. A company has one organization and
     * one workspace per brand/product, each with its own social accounts.
     * Left optional at the schema level only until the backfill has run — see
     * migrateToOrganizations in db/seed.ts.
     */
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", index: true },
    name: { type: String, required: true },
    /** Primary admin of this workspace. Access is granted via User.workspaces[]. */
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    apiKeys: { type: [apiKeySchema], default: [] },
    socialAccounts: { type: [socialAccountSchema], default: [] },
    archivedAt: { type: Date, default: null },
    // NOTE: `plan` and `creditBalance` moved to Organization — billing belongs
    // to the customer, not to one of their brands.
  },
  { timestamps: true },
);

export type WorkspaceDoc = InferSchemaType<typeof workspaceSchema> & {
  _id: Types.ObjectId;
};

export const WorkspaceModel = model("Workspace", workspaceSchema);
