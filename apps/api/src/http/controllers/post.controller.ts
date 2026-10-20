import type { FastifyReply, FastifyRequest } from "fastify";
import { Types } from "mongoose";
import { createPostSchema, type UserRole } from "@visora/shared";
import { UserModel } from "../../db/models/index.js";
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

/**
 * Cancels a post inside the caller's own workspace. Admin/root users cancelling
 * someone else's post go through the admin route instead — this one stays
 * workspace-scoped for everyone, so an admin browsing their own posts list
 * can't reach across workspaces by accident.
 */
export async function cancel(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  return ok(
    reply,
    await cancelPost({
      workspaceId: req.auth!.workspaceId,
      postId: id,
      actor: {
        userId: req.auth!.userId,
        // Recorded for the audit trail only; it grants nothing here.
        role: await resolveCallerRole(req),
      },
    }),
  );
}

/**
 * Audit label ONLY — never an authorization input. Collapses the three role
 * tiers onto the legacy vocabulary that `Post.cancelledBy.role` still stores:
 * platform staff read as "root", a tenant root as "admin", everyone else as
 * "user". API-key callers have no user behind them and label as "user".
 *
 * `assertMembership` normally populates the tiers; the lookup is a fallback so
 * the audit trail doesn't silently degrade if this handler is ever mounted on a
 * route that skips it.
 */
async function resolveCallerRole(req: FastifyRequest): Promise<UserRole> {
  const auth = req.auth;
  if (!auth) return "user";
  if (auth.platformRole === "root") return "root";
  if (auth.orgRole === "owner") return "admin";
  if (!auth.userId) return "user";

  const user = await UserModel.findById(new Types.ObjectId(auth.userId)).select(
    "platformRole orgRole",
  );
  if (user?.platformRole === "root") return "root";
  if (user?.orgRole === "owner") return "admin";
  return "user";
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
