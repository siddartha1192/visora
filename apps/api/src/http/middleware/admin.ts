import type { FastifyRequest } from "fastify";
import { Types } from "mongoose";
import { UserModel } from "../../db/models/index.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";

/**
 * Runs after `authenticate`. Rejects the request unless the user is admin or
 * root, and attaches the resolved role onto `req.auth.userRole` so downstream
 * handlers (e.g. root-only actions inside the users controller) don't need a
 * second DB round-trip.
 */
export async function requireAdmin(req: FastifyRequest) {
  if (!req.auth?.userId) throw new UnauthorizedError();
  const user = await UserModel.findById(new Types.ObjectId(req.auth.userId));
  if (!user || (user.role !== "admin" && user.role !== "root")) {
    throw new ForbiddenError("Admin access required");
  }
  req.auth.userRole = user.role;
}

/** Rejects the request unless the caller is root. Run `requireAdmin` first. */
export function requireRoot(req: FastifyRequest) {
  if (req.auth?.userRole !== "root") {
    throw new ForbiddenError("Root access required");
  }
}
