import type { FastifyReply, FastifyRequest } from "fastify";
import { Types } from "mongoose";
import { createInvitationSchema, acceptInvitationSchema } from "@visora/shared";
import * as invitationService from "../../modules/workspace/invitation.service.js";
import { adminableWorkspaceIds } from "./admin.controller.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { created, ok } from "../reply.js";

/**
 * Self-serve email invites onto one workspace. Authorization reuses exactly
 * the same predicate as `admin.createUser` (Phase 1's direct-provisioning
 * flow) — `adminableWorkspaceIds` — so a workspace admin can only invite onto
 * workspaces they administer, and a tenant root can invite onto any workspace
 * in their org. There is no parallel permission path here.
 */
export async function createInvite(req: FastifyRequest, reply: FastifyReply) {
  const { id: workspaceId } = req.params as { id: string };
  if (!Types.ObjectId.isValid(workspaceId)) throw new BadRequestError("Invalid workspace id");

  const input = createInvitationSchema.parse(req.body);
  const auth = req.auth!;

  const allowed = await adminableWorkspaceIds(req);
  if (
    auth.platformRole !== "root" &&
    !allowed.some((w) => w.toString() === workspaceId)
  ) {
    throw new ForbiddenError("You do not administer that workspace");
  }

  const result = await invitationService.createInvitation({
    workspaceId,
    organizationId: auth.organizationId,
    email: input.email,
    role: input.role,
    invitedByUserId: auth.userId!,
  });

  return created(reply, result);
}

/** Invitations on one workspace — 404s if the caller does not administer it. */
export async function listInvites(req: FastifyRequest, reply: FastifyReply) {
  const { id: workspaceId } = req.params as { id: string };
  if (!Types.ObjectId.isValid(workspaceId)) throw new NotFoundError("Workspace");

  const auth = req.auth!;
  const allowed = await adminableWorkspaceIds(req);
  if (auth.platformRole !== "root" && !allowed.some((w) => w.toString() === workspaceId)) {
    throw new NotFoundError("Workspace");
  }

  return ok(reply, await invitationService.listInvitationsForWorkspaces([new Types.ObjectId(workspaceId)]));
}

export async function revokeInvite(req: FastifyRequest, reply: FastifyReply) {
  const { invitationId } = req.params as { invitationId: string };
  const auth = req.auth!;

  if (auth.platformRole === "root") {
    await invitationService.revokeInvitation(invitationId, null);
    return ok(reply, { revoked: invitationId });
  }

  const allowed = await adminableWorkspaceIds(req);
  if (allowed.length === 0) throw new NotFoundError("Invitation");
  await invitationService.revokeInvitation(invitationId, allowed);
  return ok(reply, { revoked: invitationId });
}

// ── Public — no auth ──────────────────────────────────────────────────────

export async function previewInvite(req: FastifyRequest, reply: FastifyReply) {
  const { token } = req.params as { token: string };
  return ok(reply, await invitationService.previewInvitation(token));
}

export async function acceptInvite(req: FastifyRequest, reply: FastifyReply) {
  const { token } = req.params as { token: string };
  const input = acceptInvitationSchema.parse(req.body);
  const result = await invitationService.acceptInvitation(token, input);
  return created(reply, result);
}
