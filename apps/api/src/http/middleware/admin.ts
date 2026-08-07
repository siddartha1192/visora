import type { FastifyRequest } from "fastify";
import { Types } from "mongoose";
import { UserModel } from "../../db/models/index.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";

/** Runs after `authenticate`. Rejects the request if the user is not admin. */
export async function requireAdmin(req: FastifyRequest) {
  if (!req.auth?.userId) throw new UnauthorizedError();
  const user = await UserModel.findById(new Types.ObjectId(req.auth.userId));
  if (!user?.isAdmin) throw new ForbiddenError("Admin access required");
}
