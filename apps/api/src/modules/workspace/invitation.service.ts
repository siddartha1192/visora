import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { Types } from "mongoose";
import type { CreateInvitationInput, CreatedInvitationDTO, InvitationDTO, InvitationPreviewDTO } from "@visora/shared";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import {
  InvitationModel,
  OrganizationModel,
  UserModel,
  WorkspaceModel,
  type InvitationDoc,
} from "../../db/models/index.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";

type InvitationHydratedDoc = InstanceType<typeof InvitationModel>;

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * No mail sender exists in this stack (see `.env.example` — every provider
 * key blank falls back to a deterministic stub, and there is no SMTP/SES/
 * Resend equivalent). The invite link is therefore always returned directly
 * in the API response, exactly like `create-platform-admin` hands back
 * credentials and `provisionTenant` hands back the owner's login — and it is
 * additionally logged here so a developer running locally can find it without
 * inspecting network responses.
 */
function logInviteLink(email: string, acceptUrl: string) {
  logger.info({ email, acceptUrl }, "invitation created — no mailer configured, link logged for dev use");
}

function buildAcceptUrl(token: string): string {
  return `${env.WEB_ORIGIN.replace(/\/$/, "")}/invite/${token}`;
}

async function toDTO(inv: InvitationDoc, workspaceName: string, invitedByName: string): Promise<InvitationDTO> {
  return {
    id: inv._id.toString(),
    organizationId: inv.organizationId.toString(),
    workspaceId: inv.workspaceId.toString(),
    workspaceName,
    email: inv.email,
    role: inv.role as InvitationDTO["role"],
    status: inv.status as InvitationDTO["status"],
    invitedByName,
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: (inv as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

/**
 * Creates an invitation onto `workspaceId`. Authorization is the caller's
 * responsibility (the route/controller reuses `adminableWorkspaceIds`, the
 * same predicate `admin.createUser` already uses) — this function only
 * enforces the invariants an invite itself must hold: no invite for an
 * already-registered email, and no duplicate pending invite for the same
 * email+workspace.
 */
export async function createInvitation(input: {
  workspaceId: string;
  organizationId: string;
  email: string;
  role: CreateInvitationInput["role"];
  invitedByUserId: string;
}): Promise<CreatedInvitationDTO> {
  const workspace = await WorkspaceModel.findById(new Types.ObjectId(input.workspaceId));
  if (!workspace) throw new NotFoundError("Workspace");

  const email = input.email.toLowerCase();
  const existingUser = await UserModel.findOne({ email });
  if (existingUser) throw new ConflictError("Email already registered");

  const existingPending = await InvitationModel.findOne({
    workspaceId: workspace._id,
    email,
    status: "pending",
  });
  if (existingPending) {
    existingPending.status = "revoked";
    await existingPending.save();
  }

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = await argon2.hash(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const invitation = await InvitationModel.create({
    organizationId: workspace.organizationId,
    workspaceId: workspace._id,
    email,
    role: input.role,
    tokenHash,
    invitedBy: new Types.ObjectId(input.invitedByUserId),
    expiresAt,
    status: "pending",
  });

  const inviter = await UserModel.findById(new Types.ObjectId(input.invitedByUserId)).select("name").lean();
  const acceptUrl = buildAcceptUrl(rawToken);
  logInviteLink(email, acceptUrl);

  return {
    invitation: await toDTO(invitation, workspace.name, inviter?.name ?? "—"),
    token: rawToken,
    acceptUrl,
  };
}

/** Invitations visible to the caller, restricted to a set of workspace ids (never unrestricted for a customer caller). */
export async function listInvitationsForWorkspaces(workspaceIds: Types.ObjectId[]): Promise<InvitationDTO[]> {
  const invites = await InvitationModel.find({ workspaceId: { $in: workspaceIds } })
    .sort({ createdAt: -1 })
    .lean();
  if (invites.length === 0) return [];

  const wsIds = [...new Set(invites.map((i) => i.workspaceId.toString()))].map((id) => new Types.ObjectId(id));
  const inviterIds = [...new Set(invites.map((i) => i.invitedBy.toString()))].map((id) => new Types.ObjectId(id));
  const [workspaces, inviters] = await Promise.all([
    WorkspaceModel.find({ _id: { $in: wsIds } }).select("name").lean(),
    UserModel.find({ _id: { $in: inviterIds } }).select("name").lean(),
  ]);
  const wsNames = new Map(workspaces.map((w) => [w._id.toString(), w.name]));
  const inviterNames = new Map(inviters.map((u) => [u._id.toString(), u.name]));

  return Promise.all(
    invites.map((i) =>
      toDTO(
        i as unknown as InvitationDoc,
        wsNames.get(i.workspaceId.toString()) ?? "—",
        inviterNames.get(i.invitedBy.toString()) ?? "—",
      ),
    ),
  );
}

/**
 * Marks a pending invitation revoked. `workspaceIds === null` means
 * unrestricted and must be passed ONLY for platform staff — every customer
 * caller supplies a concrete list, same convention as `visibleWorkspaceIds`.
 */
export async function revokeInvitation(
  invitationId: string,
  workspaceIds: Types.ObjectId[] | null,
): Promise<void> {
  if (!Types.ObjectId.isValid(invitationId)) throw new NotFoundError("Invitation");
  const scope = workspaceIds !== null ? { workspaceId: { $in: workspaceIds } } : {};
  const invite = await InvitationModel.findOne({ ...scope, _id: new Types.ObjectId(invitationId) });
  if (!invite) throw new NotFoundError("Invitation");
  if (invite.status !== "pending") throw new BadRequestError("Only a pending invitation can be revoked");
  invite.status = "revoked";
  await invite.save();
}

/** Loads a still-valid pending invitation by its raw token, or throws. Public — no auth. */
async function loadPendingInvitation(rawToken: string): Promise<InvitationHydratedDoc> {
  // The token is opaque and unindexed by design (only its hash is stored), so
  // every pending invite is compared — acceptable at invite volumes, and
  // exactly how API-key secret verification already works.
  const candidates = await InvitationModel.find({ status: "pending" });
  for (const inv of candidates) {
    if (await argon2.verify(inv.tokenHash, rawToken)) {
      if (inv.expiresAt < new Date()) {
        inv.status = "expired";
        await inv.save();
        throw new BadRequestError("This invitation has expired");
      }
      return inv;
    }
  }
  throw new NotFoundError("Invitation");
}

export async function previewInvitation(rawToken: string): Promise<InvitationPreviewDTO> {
  const invite = await loadPendingInvitation(rawToken);
  const [org, workspace] = await Promise.all([
    OrganizationModel.findById(invite.organizationId).select("name").lean(),
    WorkspaceModel.findById(invite.workspaceId).select("name").lean(),
  ]);
  if (!org || !workspace) throw new NotFoundError("Invitation");

  return {
    organizationName: org.name,
    workspaceName: workspace.name,
    email: invite.email,
    role: invite.role as InvitationPreviewDTO["role"],
    expiresAt: invite.expiresAt.toISOString(),
  };
}

/**
 * Accepts an invitation: creates the user bound to the invited workspace with
 * the invited role, and marks the invitation accepted. Public/unauthenticated
 * — the token itself is the credential, exactly like a password-reset link.
 */
export async function acceptInvitation(
  rawToken: string,
  input: { name: string; password: string },
): Promise<{ userId: string; email: string }> {
  const invite = await loadPendingInvitation(rawToken);

  const existingUser = await UserModel.findOne({ email: invite.email });
  if (existingUser) {
    // The email was claimed by another path between invite-creation and
    // accept (e.g. direct-create by an admin). Fail the invite rather than
    // silently merging accounts.
    invite.status = "revoked";
    await invite.save();
    throw new ConflictError("Email already registered");
  }

  const workspace = await WorkspaceModel.findById(invite.workspaceId);
  if (!workspace || workspace.archivedAt) {
    throw new ForbiddenError("This workspace is no longer available");
  }

  const user = await UserModel.create({
    name: input.name,
    email: invite.email,
    passwordHash: await argon2.hash(input.password),
    status: "active",
    organizationId: invite.organizationId,
    orgRole: "member",
    platformRole: null,
    workspaces: [{ workspaceId: invite.workspaceId, role: invite.role }],
    defaultWorkspaceId: invite.workspaceId,
  });

  invite.status = "accepted";
  invite.acceptedAt = new Date();
  invite.acceptedUserId = user._id;
  await invite.save();

  return { userId: user._id.toHexString(), email: user.email };
}
