import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { WORKSPACE_ROLES } from "@visora/shared";

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
    workspaces: { type: [membershipSchema], default: [] },
    defaultWorkspaceId: { type: Schema.Types.ObjectId, ref: "Workspace" },
    status: {
      type: String,
      enum: ["active", "invited", "suspended"],
      default: "active",
    },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

export const UserModel = model("User", userSchema);
