import type { FastifyReply, FastifyRequest } from "fastify";
import { createPostSchema } from "@visora/shared";
import {
  approvePost,
  cancelPost,
  createPost,
  getPost,
  listPosts,
  rejectPost,
  retryPost,
} from "../../modules/posts/post.service.js";
import { accepted, ok } from "../reply.js";
import { moderateTexts, ContentPolicyViolationError, HIGH_RISK_KEYWORDS } from "../../lib/moderation.js";

/**
 * The workflow entrypoint. Validates against the discriminated union (so the
 * router downstream can trust `workflow`), creates the draft + job, returns 202.
 * Identical for web users (JWT) and external systems (API key).
 */
export async function create(req: FastifyRequest, reply: FastifyReply) {
  const input = createPostSchema.parse(req.body);

  // Screen all free-text fields before queuing — fastest possible rejection point.
  const textsToScreen = [
    (input as { brief?: string }).brief,
    (input as { prompt?: string }).prompt,
    (input as { instructions?: string }).instructions,
    (input as { context?: string }).context,
    (input as { enhanceInstructions?: string }).enhanceInstructions,
    input.caption?.text,
  ];

  // Keyword pre-filter before the API call — catches terms the scoring threshold misses.
  const allText = textsToScreen.filter(Boolean).join(" ");
  if (HIGH_RISK_KEYWORDS.some((re) => re.test(allText))) {
    return reply.code(422).send({
      ok: false,
      error: {
        code: "CONTENT_POLICY_VIOLATION",
        message: "Your content contains terms that are not permitted on this platform. Please revise your content and try again.",
      },
    });
  }

  try {
    await moderateTexts(textsToScreen);
  } catch (err) {
    if (err instanceof ContentPolicyViolationError) {
      return reply.code(422).send({
        ok: false,
        error: { code: err.code, message: err.userMessage },
      });
    }
    throw err;
  }

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

export async function retry(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const { mode } = (req.body ?? {}) as { mode?: "from_failed" | "full" };
  if (mode !== "from_failed" && mode !== "full") {
    return reply.code(400).send({
      ok: false,
      error: { code: "INVALID_MODE", message: 'mode must be "from_failed" or "full"' },
    });
  }
  return accepted(reply, await retryPost(req.auth!.workspaceId, id, mode));
}
