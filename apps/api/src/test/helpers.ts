import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { Types } from "mongoose";
import { buildServer } from "../http/server.js";
import { OrganizationModel, UserModel, WorkspaceModel } from "../db/models/index.js";
import type { OrgRole, WorkspaceRole } from "@visora/shared";

/** One Fastify instance per test file — cheap since it never opens a real socket. */
export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildServer();
  await app.ready();
  return app;
}

export interface SeededOrg {
  orgId: string;
  workspaceId: string;
  ownerId: string;
  ownerToken: string;
}

/**
 * Creates an organization with one owner and one default workspace, mirroring
 * `provisionTenant`'s shape without going through the HTTP layer — the two-org
 * and role-matrix tests need many of these and a direct model write keeps them
 * fast and independent of any one endpoint's behaviour.
 */
export async function seedOrg(
  app: FastifyInstance,
  opts: { orgName: string; ownerEmail: string; workspaceName?: string },
): Promise<SeededOrg> {
  const org = await OrganizationModel.create({
    name: opts.orgName,
    slug: opts.orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  });

  const owner = await UserModel.create({
    name: `${opts.orgName} Owner`,
    email: opts.ownerEmail.toLowerCase(),
    passwordHash: await argon2.hash("password123"),
    status: "active",
    organizationId: org._id,
    orgRole: "owner",
    platformRole: null,
  });

  const workspace = await WorkspaceModel.create({
    organizationId: org._id,
    name: opts.workspaceName ?? `${opts.orgName} Workspace`,
    ownerId: owner._id,
  });

  owner.workspaces.push({ workspaceId: workspace._id, role: "admin" });
  owner.defaultWorkspaceId = workspace._id;
  await owner.save();

  const ownerToken = signAccessToken(app, {
    sub: owner._id.toHexString(),
    orgId: org._id.toHexString(),
    workspaceId: workspace._id.toHexString(),
  });

  return {
    orgId: org._id.toHexString(),
    workspaceId: workspace._id.toHexString(),
    ownerId: owner._id.toHexString(),
    ownerToken,
  };
}

/** Adds a second workspace to an existing org, owned by the same creator. */
export async function addWorkspace(
  orgId: string,
  name: string,
  ownerId: string,
): Promise<string> {
  const ws = await WorkspaceModel.create({
    organizationId: new Types.ObjectId(orgId),
    name,
    ownerId: new Types.ObjectId(ownerId),
  });
  return ws._id.toHexString();
}

/**
 * Creates a user with a single workspace membership and returns a signed
 * access token for them — the building block for every non-owner role in the
 * role-matrix and two-org tests.
 */
export async function seedMember(
  app: FastifyInstance,
  opts: {
    orgId: string;
    workspaceId: string;
    email: string;
    workspaceRole: WorkspaceRole;
    orgRole?: OrgRole;
  },
): Promise<{ userId: string; token: string }> {
  const user = await UserModel.create({
    name: opts.email,
    email: opts.email.toLowerCase(),
    passwordHash: await argon2.hash("password123"),
    status: "active",
    organizationId: new Types.ObjectId(opts.orgId),
    orgRole: opts.orgRole ?? "member",
    platformRole: null,
    workspaces: [{ workspaceId: new Types.ObjectId(opts.workspaceId), role: opts.workspaceRole }],
    defaultWorkspaceId: new Types.ObjectId(opts.workspaceId),
  });

  const token = signAccessToken(app, {
    sub: user._id.toHexString(),
    orgId: opts.orgId,
    workspaceId: opts.workspaceId,
  });

  return { userId: user._id.toHexString(), token };
}

/** Platform staff: no organization, `platformRole: 'root'`. */
export async function seedPlatformRoot(
  app: FastifyInstance,
  email = "root@platform.test",
): Promise<{ userId: string; token: string }> {
  const user = await UserModel.create({
    name: "Platform Root",
    email: email.toLowerCase(),
    passwordHash: await argon2.hash("password123"),
    status: "active",
    organizationId: null,
    orgRole: null,
    platformRole: "root",
  });

  // Platform staff have no workspace; routes that need one (the shared
  // authenticated /v1 group) are irrelevant to them — only /v1/admin/* and
  // /v1/platform/* matter, neither of which runs assertMembership.
  const token = signAccessToken(app, {
    sub: user._id.toHexString(),
    orgId: "",
    workspaceId: "",
  });

  return { userId: user._id.toHexString(), token };
}

function signAccessToken(
  app: FastifyInstance,
  claims: { sub: string; orgId: string; workspaceId: string },
): string {
  return app.jwt.sign(claims, { expiresIn: "15m" });
}

export function signRefreshToken(
  app: FastifyInstance,
  claims: { sub: string; orgId: string; workspaceId: string },
): string {
  return app.jwt.sign({ ...claims, typ: "refresh" }, { expiresIn: "30d" });
}

export function authHeader(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
