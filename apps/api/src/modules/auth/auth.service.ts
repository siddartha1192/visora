import argon2 from "argon2";
import type { LoginInput } from "@visora/shared";
import { OrganizationModel, UserModel } from "../../db/models/index.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  defaultWorkspaceId: string;
}

/**
 * NOTE: public self-registration was removed. It was the only thing that
 * created a workspace, and it handed one to any anonymous caller — incompatible
 * with tenants being provisioned off a subscription. New customers now come
 * from `POST /v1/platform/tenants` (platform staff only); new colleagues from
 * `POST /v1/admin/users` (their own org's admins).
 */

export async function verifyCredentials(input: LoginInput): Promise<AuthedUser> {
  const user = await UserModel.findOne({ email: input.email });
  if (!user) throw new UnauthorizedError("Invalid email or password");

  const ok = await argon2.verify(user.passwordHash, input.password);
  if (!ok) throw new UnauthorizedError("Invalid email or password");

  // Suspension was previously decorative — an admin could set status to
  // "suspended" and the account would keep logging in. Checked *after* the
  // password so this can't be used to enumerate which accounts are suspended,
  // and before lastLoginAt is written so a refused attempt isn't recorded as
  // a successful login.
  if (user.status !== "active") {
    throw new ForbiddenError(
      user.status === "suspended"
        ? "Your account has been suspended. Contact your administrator."
        : "Your account is not active.",
    );
  }

  // A suspended tenant must not be reachable through any of its members.
  // Platform staff have no organization and are unaffected.
  if (user.organizationId) {
    const org = await OrganizationModel.findById(user.organizationId).select("status").lean();
    if (org && org.status !== "active") {
      throw new ForbiddenError("Your organization has been suspended.");
    }
  }

  // ROOT_EMAILS auto-promotion used to live here. It granted platform access on
  // login to any account matching an env-var list, which — with registration
  // open — meant whoever registered that address first became platform root.
  // Platform staff are now created explicitly via the create-platform-admin CLI.

  user.lastLoginAt = new Date();
  await user.save();

  return {
    id: user._id.toHexString(),
    email: user.email,
    name: user.name,
    organizationId: user.organizationId?.toHexString() ?? "",
    defaultWorkspaceId:
      user.defaultWorkspaceId?.toHexString() ??
      user.workspaces[0]?.workspaceId.toHexString() ??
      "",
  };
}
