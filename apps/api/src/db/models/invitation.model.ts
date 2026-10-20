import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { WORKSPACE_ROLES } from "@visora/shared";

export const INVITATION_STATUSES = ["pending", "accepted", "expired", "revoked"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/**
 * A self-serve invite onto one workspace. The recipient sets their own
 * password on accept — this is the tokened-link counterpart to
 * `admin.createUser`'s direct-create flow (Phase 1), not a replacement for it.
 *
 * `tokenHash` stores an argon2 hash of the raw token, mirroring how API keys
 * are stored (`Workspace.apiKeys[].hashedKey`): the raw token is handed back
 * exactly once, at creation, and is unrecoverable afterwards.
 */
const invitationSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: WORKSPACE_ROLES, required: true },
    tokenHash: { type: String, required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: INVITATION_STATUSES, default: "pending" },
    acceptedAt: { type: Date, default: null },
    acceptedUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

export type InvitationDoc = InferSchemaType<typeof invitationSchema> & {
  _id: Types.ObjectId;
};

export const InvitationModel = model("Invitation", invitationSchema);
