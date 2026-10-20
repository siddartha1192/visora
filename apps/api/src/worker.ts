import "dotenv/config";
import { connectMongo, disconnectMongo } from "./db/connection.js";
import { logger } from "./lib/logger.js";
import { startPostWorker, reconcileScheduledPosts } from "./queue/post-worker.js";

const RECONCILE_INTERVAL_MS = 5 * 60_000;

/**
 * Worker process entrypoint — runs SEPARATELY from the API. Owns all LangGraph
 * execution and provider calls so slow/expensive AI work never touches the HTTP
 * request thread. Scale this independently based on queue depth.
 */
async function main() {
  await connectMongo();
  const worker = startPostWorker();

  // Re-sync Redis's delayed-publish jobs from Mongo's `schedule.runAt` on every boot —
  // this is what makes scheduling survive a wiped Redis volume or a container that was
  // down when a post's runAt passed: overdue posts publish immediately once we're back.
  // The periodic re-run is a safety net against the same class of drift mid-uptime.
  await reconcileScheduledPosts().catch((err) =>
    logger.error({ err }, "startup reconciliation of scheduled posts failed"),
  );
  const reconcileTimer = setInterval(() => {
    reconcileScheduledPosts().catch((err) =>
      logger.error({ err }, "periodic reconciliation of scheduled posts failed"),
    );
  }, RECONCILE_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    clearInterval(reconcileTimer);
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
