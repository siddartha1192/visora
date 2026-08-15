import type { FastifyReply, FastifyRequest } from "fastify";
import { loginSchema, refreshSchema } from "@visora/shared";
import { Types } from "mongoose";
import { env } from "../../config/env.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";
import { verifyCredentials, type AuthedUser } from "../../modules/auth/auth.service.js";
import { OrganizationModel, UserModel, WorkspaceModel } from "../../db/models/index.js";
import {
  toOrganizationDTO,
  toWorkspaceDTO,
} from "../../modules/workspace/tenant.service.js";
import { ok } from "../reply.js";

function issueTokens(req: FastifyRequest, user: AuthedUser) {
  // `orgId` is a signed claim so downstream code has the tenant without a
  // lookup — but it is always re-read from the database in assertMembership,
  // so a stale or tampered claim can never widen access.
  const claims = {
    sub: user.id,
    orgId: user.organizationId,
    workspaceId: user.defaultWorkspaceId,
  };
  const accessToken = req.server.jwt.sign(claims, { expiresIn: env.JWT_ACCESS_TTL });
  const refreshToken = req.server.jwt.sign(
    { ...claims, typ: "refresh" },
    { expiresIn: env.JWT_REFRESH_TTL },
  );
  return {
    user,
    tokens: { accessToken, refreshToken, expiresIn: 900 },
  };
}

export async function login(req: FastifyRequest, reply: FastifyReply) {
  const input = loginSchema.parse(req.body);
  const user = await verifyCredentials(input);
  return ok(reply, issueTokens(req, user));
}

export async function refresh(req: FastifyRequest, reply: FastifyReply) {
  const { refreshToken } = refreshSchema.parse(req.body);
  let decoded: { sub: string; orgId?: string; workspaceId: string; typ?: string };
  try {
    decoded = req.server.jwt.verify(refreshToken);
  } catch {
    throw new UnauthorizedError("Invalid refresh token");
  }
  if (decoded.typ !== "refresh") throw new UnauthorizedError("Not a refresh token");

  // Re-check the account on refresh. Without this a suspended user — or one
  // whose whole tenant was suspended — keeps minting access tokens for as long
  // as their 30-day refresh token lives.
  const user = await UserModel.findById(new Types.ObjectId(decoded.sub)).select(
    "status organizationId",
  );
  if (!user) throw new UnauthorizedError("Invalid refresh token");
  if (user.status !== "active") throw new ForbiddenError("Account is not active");

  const accessToken = req.server.jwt.sign(
    {
      sub: decoded.sub,
      orgId: user.organizationId?.toString() ?? decoded.orgId,
      workspaceId: decoded.workspaceId,
    },
    { expiresIn: env.JWT_ACCESS_TTL },
  );
  return ok(reply, { accessToken, expiresIn: 900 });
}

/**
 * The caller's identity plus everything the UI gates on: which tier they are,
 * which tenant they belong to, and which workspaces they can actually reach —
 * resolved server-side so the client never has to infer access.
 */
export async function me(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.auth!;
  const user = auth.userId
    ? await UserModel.findById(new Types.ObjectId(auth.userId)).lean()
    : null;

  const org = user?.organizationId
    ? await OrganizationModel.findById(user.organizationId).lean()
    : null;

  const memberships = new Map(
    (user?.workspaces ?? []).map((w) => [w.workspaceId.toString(), w.role as string]),
  );

  // The tenant root reaches every workspace in their org; everyone else only
  // the ones they hold a membership on.
  const isOwner = user?.orgRole === "owner" || user?.platformRole === "root";
  const workspaceRows = org
    ? await WorkspaceModel.find(
        isOwner
          ? { organizationId: org._id, archivedAt: null }
          : {
              _id: { $in: [...memberships.keys()].map((id) => new Types.ObjectId(id)) },
              archivedAt: null,
            },
      )
        .sort({ createdAt: -1 })
        .lean()
    : [];

  return ok(reply, {
    id: user?._id?.toString() ?? auth.userId ?? "",
    name: user?.name ?? auth.userName ?? "",
    email: user?.email ?? auth.userEmail ?? "",
    avatarUrl: user?.avatarUrl ?? null,
    platformRole: user?.platformRole ?? null,
    orgRole: user?.orgRole ?? null,
    organization: org
      ? toOrganizationDTO(org as Parameters<typeof toOrganizationDTO>[0])
      : null,
    workspaces: workspaceRows.map((w) =>
      toWorkspaceDTO(
        w as Parameters<typeof toWorkspaceDTO>[0],
        memberships.get((w._id as Types.ObjectId).toString()),
      ),
    ),
    activeWorkspaceId: auth.workspaceId || null,
  });
}
