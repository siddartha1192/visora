import type { LogEntry, LogLevel, LogTransport, UserContext } from "./types.js";

/**
 * Application logger with pluggable transports and scoped child loggers.
 *
 * Usage:
 *   // root logger (no user context)
 *   appLog.info("server started", { port: 4000 });
 *
 *   // request-scoped logger (user baked in for every call)
 *   const reqLog = appLog.withUser({ id: userId, name: "Alice" });
 *   reqLog.info("post created", { postId });
 *   reqLog.error("generation failed", { err: error.message });
 *
 *   // job-scoped logger
 *   const jobLog = appLog.child({ jobId, workspaceId });
 *   jobLog.warn("retry attempt", { attempt: 2 });
 */
export class AppLogger {
  constructor(
    private readonly transports: LogTransport[],
    private readonly ctx: Record<string, unknown> = {},
  ) {}

  /** Returns a new logger that merges `ctx` into every entry it emits. */
  child(ctx: Record<string, unknown>): AppLogger {
    return new AppLogger(this.transports, { ...this.ctx, ...ctx });
  }

  /** Convenience: attach a user to every subsequent log entry. */
  withUser(user: UserContext): AppLogger {
    return this.child({ user });
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.emit("INFO", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.emit("WARN", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.emit("ERROR", message, meta);
  }

  private emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: "visora-api",
      ...this.ctx,
      ...meta,
    };

    for (const transport of this.transports) {
      try {
        const result = transport.write(entry);
        // Swallow async transport errors — logging must never crash the app.
        if (result instanceof Promise) result.catch(() => {});
      } catch {
        // Swallow sync transport errors too.
      }
    }
  }

  /** Call on graceful shutdown so transports can flush buffers. */
  async close(): Promise<void> {
    await Promise.allSettled(
      this.transports.map((t) => t.close?.()),
    );
  }
}
