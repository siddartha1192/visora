import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import type { ApiError } from "@visora/shared";
import { isAppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";

/** Maps any thrown error to the uniform ApiError envelope + correct status. */
export function errorHandler(
  err: FastifyError | Error,
  _req: FastifyRequest,
  reply: FastifyReply,
) {
  if (err instanceof ZodError) {
    const body: ApiError = {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: err.flatten(),
      },
    };
    return reply.code(422).send(body);
  }

  if (isAppError(err)) {
    const body: ApiError = {
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
    };
    return reply.code(err.statusCode).send(body);
  }

  // Fastify validation / rate-limit errors carry a statusCode.
  const status = (err as FastifyError).statusCode ?? 500;
  if (status >= 500) logger.error({ err }, "unhandled error");

  const body: ApiError = {
    ok: false,
    error: {
      code: status === 429 ? "RATE_LIMITED" : "INTERNAL_ERROR",
      message: status >= 500 ? "Internal server error" : err.message,
    },
  };
  return reply.code(status).send(body);
}
