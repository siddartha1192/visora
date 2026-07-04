import type { FastifyReply, FastifyRequest } from "fastify";
import { createPostSchema } from "@visora/shared";
import {
  approvePost,
  cancelPost,
  createPost,
  getPost,
  listPosts,
  rejectPost,
} from "../../modules/posts/post.service.js";
import { accepted, ok } from "../reply.js";

/**
 * The workflow entrypoint. Validates against the discriminated union (so the
 * router downstream can trust `workflow`), creates the draft + job, returns 202.
 * Identical for web users (JWT) and external systems (API key).
 */
export async function create(req: FastifyRequest, reply: FastifyReply) {
  const input = createPostSchema.parse(req.body);
  const dto = await createPost({
    workspaceId: req.auth!.workspaceId,
    authorId: req.auth!.userId ?? req.auth!.workspaceId,
    input,
  });
  return accepted(reply, dto);
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const q = req.query as { page?: string; pageSize?: string };
  const result = await listPosts(
    req.auth!.workspaceId,
    Number(q.page) || 1,
    Number(q.pageSize) || 20,
  );
  return ok(reply, result);
}

export async function getOne(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  return ok(reply, await getPost(req.auth!.workspaceId, id));
}

export async function cancel(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  return ok(reply, await cancelPost(req.auth!.workspaceId, id));
}

export async function approve(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as {
    scheduledAt?: string;
    scheduleMode?: "instant" | "scheduled";
  };
  return ok(
    reply,
    await approvePost(req.auth!.workspaceId, id, {
      scheduledAt: body.scheduledAt,
      scheduleMode: body.scheduleMode,
    }),
  );
}

export async function reject(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  return ok(reply, await rejectPost(req.auth!.workspaceId, id));
}
