/**
 * FILE: log.controller.ts
 * Pipeline execution log endpoints.
 *
 * GET /v1/posts/:id/logs        — returns all AgentLog entries for a post sorted by createdAt.
 * GET /v1/posts/:id/logs/stream — SSE endpoint that streams new log entries as they are written,
 *                                 polling MongoDB every 500 ms. Closes automatically when a
 *                                 pipeline-level "succeeded" or "failed" entry appears.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { Types } from "mongoose";
import { AgentLogModel, type AgentLogDoc } from "../../db/models/index.js";

interface IdParam {
  id: string;
}

// ── Shared formatting ──────────────────────────────────────────────────────────

function formatLog(log: AgentLogDoc & { createdAt?: Date }) {
  return {
    id: log._id.toString(),
    sequence: log.sequence,
    node: log.node,
    status: log.status,
    message: log.message ?? `${log.node}: ${log.status}`,
    data: log.data ?? null,
    durationMs: log.durationMs ?? null,
    provider: log.provider?.name ?? null,
    model: log.provider?.model ?? null,
    usage: log.usage ?? null,
    error: log.error?.message ?? null,
    createdAt: log.createdAt ?? null,
  };
}

function isPipelineDone(log: AgentLogDoc): boolean {
  return log.node === "pipeline" && (log.status === "succeeded" || log.status === "failed");
}

/**
 * Tenant-scoped log filter. `postId` alone is NOT sufficient: an ObjectId is
 * guessable/enumerable, and without the workspace clause any authenticated
 * caller could read another workspace's prompts, model output and cost data.
 * `AgentLog` carries `workspaceId` precisely so this filter is possible.
 */
function logFilter(req: FastifyRequest, postId: string) {
  return {
    postId: new Types.ObjectId(postId),
    workspaceId: new Types.ObjectId(req.auth!.workspaceId),
  };
}

// ── GET /v1/posts/:id/logs ────────────────────────────────────────────────────

export async function getLogs(
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply,
) {
  const { id } = request.params;
  if (!Types.ObjectId.isValid(id)) {
    return reply.code(400).send({ ok: false, error: { code: "INVALID_ID", message: "Invalid post ID" } });
  }

  const logs = await AgentLogModel
    .find(logFilter(request, id))
    .sort({ createdAt: 1 })
    .lean();

  const done = logs.some(isPipelineDone);

  return reply.send({
    ok: true,
    data: {
      postId: id,
      done,
      logs: logs.map(formatLog),
    },
  });
}

// ── GET /v1/posts/:id/logs/stream (SSE) ──────────────────────────────────────

export async function streamLogs(
  request: FastifyRequest<{ Params: IdParam }>,
  reply: FastifyReply,
) {
  const { id } = request.params;
  if (!Types.ObjectId.isValid(id)) {
    return reply.code(400).send({ ok: false, error: { code: "INVALID_ID", message: "Invalid post ID" } });
  }

  const res = reply.raw;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");  // disable nginx buffering
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  // ── 1. Send all existing entries immediately ─────────────────────────────
  const scoped = logFilter(request, id);
  const existing = await AgentLogModel
    .find(scoped)
    .sort({ createdAt: 1 })
    .lean();

  for (const log of existing) {
    send("log", formatLog(log));
  }

  const alreadyDone = existing.some(isPipelineDone);
  if (alreadyDone) {
    send("done", { reason: "pipeline already completed" });
    res.end();
    return;
  }

  send("connected", { postId: id, logCount: existing.length });

  // ── 2. Poll for new entries every 500 ms ────────────────────────────────
  let lastCreatedAt: Date = existing.at(-1)?.createdAt ?? new Date(0);
  let finished = false;

  const poll = setInterval(async () => {
    if (finished || res.writableEnded) {
      clearInterval(poll);
      return;
    }
    try {
      const newLogs = await AgentLogModel
        .find({ ...scoped, createdAt: { $gt: lastCreatedAt } })
        .sort({ createdAt: 1 })
        .lean();

      for (const log of newLogs) {
        send("log", formatLog(log));
        if (isPipelineDone(log)) finished = true;
        if (log.createdAt && log.createdAt > lastCreatedAt) lastCreatedAt = log.createdAt;
      }

      if (finished) {
        send("done", { reason: "pipeline finished" });
        res.end();
        clearInterval(poll);
        clearInterval(heartbeat);
        clearTimeout(maxTimeout);
      }
    } catch {
      // swallow transient errors — the next poll will retry
    }
  }, 500);

  // ── 3. Heartbeat every 15 s to keep proxies from closing the connection ─
  const heartbeat = setInterval(() => {
    if (!finished && !res.writableEnded) {
      res.write(": ping\n\n");
    }
  }, 15_000);

  // ── 4. Hard cap: close after 10 minutes ─────────────────────────────────
  const maxTimeout = setTimeout(() => {
    if (!finished && !res.writableEnded) {
      send("timeout", { reason: "max stream duration reached" });
      res.end();
    }
    clearInterval(poll);
    clearInterval(heartbeat);
  }, 600_000);

  // ── 5. Cleanup on client disconnect ─────────────────────────────────────
  return new Promise<void>((resolve) => {
    res.on("close", () => {
      finished = true;
      clearInterval(poll);
      clearInterval(heartbeat);
      clearTimeout(maxTimeout);
      resolve();
    });
  });
}
