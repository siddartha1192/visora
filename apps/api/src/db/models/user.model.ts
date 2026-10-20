import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { ORG_ROLES, PLATFORM_ROLES, USER_ROLES, WORKSPACE_ROLES } from "@visora/shared";

const membershipSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
    role: { type: String, enum: WORKSPACE_ROLES, required: true },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    avatarUrl: { type: String },

    /**
     * The tenant this user belongs to. Required for every customer account, and
     * null ONLY for platform staff, who are not customers and belong to no
     * organization. Enforced by the validator below rather than `required` so
     * that exception can be expressed.
     */
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    orgRole: { type: String, enum: ORG_ROLES, default: null },

    /** SaaS operator staff. Separate field from orgRole on purpose — see enums.ts. */
    platformRole: { type: String, enum: PLATFORM_ROLES, default: null },

    workspaces: { type: [membershipSchema], default: [] },
    defaultWorkspaceId: { type: Schema.Types.ObjectId, ref: "Workspace" },
    status: {
      type: String,
      enum: ["active", "invited", "suspended"],
      default: "active",
    },
    /** @deprecated legacy single-tier role — read by the backfill migration only. */
    role: { type: String, enum: USER_ROLES },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

/**
 * Every customer account must belong to an organization; platform staff must
 * not. Without this, a user with a null organizationId would silently escape
 * all org scoping.
 */
userSchema.pre("validate", function (next) {
  const isPlatformStaff = this.platformRole === "root";
  if (!isPlatformStaff && !this.organizationId) {
    return next(new Error("User.organizationId is required for non-platform accounts"));
  }
  if (!isPlatformStaff && !this.orgRole) {
    return next(new Error("User.orgRole is required for non-platform accounts"));
  }
  next();
});

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

export const UserModel = model("User", userSchema);
