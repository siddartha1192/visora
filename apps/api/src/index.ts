import "dotenv/config";
import { env } from "./config/env.js";
import { connectMongo, disconnectMongo } from "./db/connection.js";
import { migrateToOrganizations, migrateUserRoles, seedLlmConfigs } from "./db/seed.js";
import { logger } from "./lib/logger.js";
import { buildServer } from "./http/server.js";
import { postQueue } from "./queue/post-queue.js";

/**
 * API process entrypoint. Connects Mongo, starts Fastify. Does NOT start the
 * worker — run `pnpm dev:worker` (or the worker container) separately so HTTP
 * latency is never coupled to LLM/media processing time.
 */
async function main() {
  await connectMongo();
  await migrateUserRoles();
  // Must run before the server accepts traffic: it throws if any user or
  // workspace lacks an organization, since such a document is invisible to
  // org scoping and would silently bypass tenant isolation.
  await migrateToOrganizations();
  await seedLlmConfigs();
  const app = await buildServer();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info(`API listening on :${env.PORT}`);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "API shutting down");
    await app.close();
    await postQueue.close();
    await disconnectMongo();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "API failed to start");
  process.exit(1);
});
