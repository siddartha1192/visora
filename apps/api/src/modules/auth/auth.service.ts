import argon2 from "argon2";
import type { LoginInput, RegisterInput } from "@visora/shared";
import { UserModel, WorkspaceModel } from "../../db/models/index.js";
import { ConflictError, UnauthorizedError } from "../../lib/errors.js";

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  defaultWorkspaceId: string;
}

export async function registerUser(input: RegisterInput): Promise<AuthedUser> {
  const existing = await UserModel.findOne({ email: input.email });
  if (existing) throw new ConflictError("Email already registered");

  const passwordHash = await argon2.hash(input.password);
  const user = await UserModel.create({
    email: input.email,
    name: input.name,
    passwordHash,
  });

  // Every user gets a default workspace (tenancy from day 1).
  const workspace = await WorkspaceModel.create({
    name: input.workspaceName ?? `${input.name}'s Workspace`,
    ownerId: user._id,
  });

  user.workspaces.push({ workspaceId: workspace._id, role: "owner" });
  user.defaultWorkspaceId = workspace._id;
  await user.save();

  return {
    id: user._id.toHexString(),
    email: user.email,
    name: user.name,
    defaultWorkspaceId: workspace._id.toHexString(),
  };
}

export async function verifyCredentials(input: LoginInput): Promise<AuthedUser> {
  const user = await UserModel.findOne({ email: input.email });
  if (!user) throw new UnauthorizedError("Invalid email or password");

  const ok = await argon2.verify(user.passwordHash, input.password);
  if (!ok) throw new UnauthorizedError("Invalid email or password");

  user.lastLoginAt = new Date();
  await user.save();

  return {
    id: user._id.toHexString(),
    email: user.email,
    name: user.name,
    defaultWorkspaceId:
      user.defaultWorkspaceId?.toHexString() ??
      user.workspaces[0]?.workspaceId.toHexString() ??
      "",
  };
}
