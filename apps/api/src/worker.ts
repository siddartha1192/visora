import { connectMongo, disconnectMongo } from "./db/connection.js";
import { logger } from "./lib/logger.js";
import { startPostWorker } from "./queue/post-worker.js";

/**
 * Worker process entrypoint — runs SEPARATELY from the API. Owns all LangGraph
 * execution and provider calls so slow/expensive AI work never touches the HTTP
 * request thread. Scale this independently based on queue depth.
 */
async function main() {
  await connectMongo();
  const worker = startPostWorker();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    await worker.close();
    await disconnectMongo();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "worker failed to start");
  process.exit(1);
});
