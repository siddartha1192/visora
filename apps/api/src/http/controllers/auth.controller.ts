import type { FastifyReply, FastifyRequest } from "fastify";
import { loginSchema, refreshSchema, registerSchema } from "@visora/shared";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../../lib/errors.js";
import {
  registerUser,
  verifyCredentials,
  type AuthedUser,
} from "../../modules/auth/auth.service.js";
import { created, ok } from "../reply.js";

function issueTokens(req: FastifyRequest, user: AuthedUser) {
  const claims = { sub: user.id, workspaceId: user.defaultWorkspaceId };
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

export async function register(req: FastifyRequest, reply: FastifyReply) {
  const input = registerSchema.parse(req.body);
  const user = await registerUser(input);
  return created(reply, issueTokens(req, user));
}

export async function login(req: FastifyRequest, reply: FastifyReply) {
  const input = loginSchema.parse(req.body);
  const user = await verifyCredentials(input);
  return ok(reply, issueTokens(req, user));
}

export async function refresh(req: FastifyRequest, reply: FastifyReply) {
  const { refreshToken } = refreshSchema.parse(req.body);
  let decoded: { sub: string; workspaceId: string; typ?: string };
  try {
    decoded = req.server.jwt.verify(refreshToken);
  } catch {
    throw new UnauthorizedError("Invalid refresh token");
  }
  if (decoded.typ !== "refresh") throw new UnauthorizedError("Not a refresh token");

  const accessToken = req.server.jwt.sign(
    { sub: decoded.sub, workspaceId: decoded.workspaceId },
    { expiresIn: env.JWT_ACCESS_TTL },
  );
  return ok(reply, { accessToken, expiresIn: 900 });
}

export async function me(req: FastifyRequest, reply: FastifyReply) {
  return ok(reply, { auth: req.auth });
}
