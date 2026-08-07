import type { FastifyReply } from "fastify";
import type { ApiResponse } from "@visora/shared";

export function ok<T>(reply: FastifyReply, data: T, status = 200) {
  const body: ApiResponse<T> = { ok: true, data };
  return reply.code(status).send(body);
}

export function created<T>(reply: FastifyReply, data: T) {
  return ok(reply, data, 201);
}

export function accepted<T>(reply: FastifyReply, data: T) {
  return ok(reply, data, 202);
}
