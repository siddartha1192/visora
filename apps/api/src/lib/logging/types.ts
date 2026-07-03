export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface UserContext {
  id: string;
  name?: string;
  email?: string;
}

/**
 * A single structured log entry. Every field beyond the four required ones
 * is open (index signature) so callers can attach arbitrary metadata.
 */
export interface LogEntry {
  timestamp: string;   // ISO 8601
  level: LogLevel;
  message: string;
  service: string;
  user?: UserContext;
  [key: string]: unknown;
}

/**
 * The extension point for log destinations.
 * Implement this interface to add a new sink (MongoDB, S3, Datadog, …)
 * and register it in src/lib/logging/index.ts — zero other changes needed.
 */
export interface LogTransport {
  readonly name: string;
  write(entry: LogEntry): void | Promise<void>;
  /** Optional teardown called on graceful shutdown. */
  close?(): void | Promise<void>;
}
