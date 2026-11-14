import "dotenv/config";
import { connectMongo, disconnectMongo } from "./db/connection.js";
import { logger } from "./lib/logger.js";
import { startPostWorker, reconcileScheduledPosts } from "./queue/post-worker.js";
import { checkAndMarkExpiredTokens } from "./modules/workspace/social-oauth.service.js";

const RECONCILE_INTERVAL_MS = 5 * 60_000;
const SOCIAL_TOKEN_CHECK_INTERVAL_MS = 24 * 60 * 60_000;

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

  // Daily sweep marking any connected Instagram/Facebook account whose token
  // Meta has invalidated (customer revoked access, Page removed, etc.) as
  // "expired" — there is no silent refresh for these tokens, see
  // checkAndMarkExpiredTokens's docstring. This just stops the fallback
  // publisher from being a surprise; reconnecting is still on the customer.
  const socialTokenCheckTimer = setInterval(() => {
    checkAndMarkExpiredTokens()
      .then(({ checked, expired }) => {
        if (expired > 0) logger.warn({ checked, expired }, "social account token check found expired tokens");
      })
      .catch((err) => logger.error({ err }, "periodic social account token check failed"));
  }, SOCIAL_TOKEN_CHECK_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    clearInterval(reconcileTimer);
    clearInterval(socialTokenCheckTimer);
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
