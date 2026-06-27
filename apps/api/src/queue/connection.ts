import type { ConnectionOptions } from "bullmq";
import { env } from "../config/env.js";

/**
 * BullMQ connection options derived from REDIS_URL. We hand BullMQ the options
 * (not a pre-built client) so it manages its own ioredis instance — avoiding
 * cross-version client type clashes and lifecycle coupling.
 * `maxRetriesPerRequest: null` is required by BullMQ for blocking commands.
 */
function parseRedisUrl(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: u.password } : {}),
    ...(u.username ? { username: u.username } : {}),
    ...(u.pathname && u.pathname !== "/"
      ? { db: Number(u.pathname.slice(1)) }
      : {}),
    maxRetriesPerRequest: null,
  };
}

export const connection: ConnectionOptions = parseRedisUrl(env.REDIS_URL);

export const POST_QUEUE_NAME = "visora:process_post";
