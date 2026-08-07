import { logger } from "./logger.js";

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
}

/** Exponential backoff with full jitter. Used to wrap flaky provider calls. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { retries = 3, baseDelayMs = 300, maxDelayMs = 5000, label = "op" } =
    opts;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > retries) throw err;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.floor(Math.random() * backoff);
      logger.warn(
        { label, attempt, delay, err: (err as Error).message },
        "retrying after failure",
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
