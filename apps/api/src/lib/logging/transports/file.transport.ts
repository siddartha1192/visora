import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { LogEntry, LogTransport } from "../types.js";

/**
 * Writes one JSON line per entry to daily-rotating files inside `dir`:
 *   app-YYYY-MM-DD.jsonl   — all levels (INFO / WARN / ERROR)
 *   error-YYYY-MM-DD.jsonl — ERROR only (easier to grep failures)
 *
 * Rotation is implicit: the date suffix changes at midnight automatically.
 * No open file handle is kept — appendFileSync opens, writes, and closes
 * on each call, which is safe for low-to-medium throughput and lets the
 * directory be archived or tailed without lock conflicts.
 *
 * --- Swapping to a different sink ---
 * Implement LogTransport with a different write() body:
 *   MongoTransport  → db.collection("logs").insertOne(entry)
 *   S3Transport     → buffer entries and flush a batch to S3 every N seconds
 *   DatadogTransport → POST to the Datadog logs intake API
 * Register the new transport in src/lib/logging/index.ts.
 */
export class FileTransport implements LogTransport {
  readonly name = "file";

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  write(entry: LogEntry): void {
    const date = entry.timestamp.slice(0, 10); // YYYY-MM-DD
    const line = JSON.stringify(entry) + "\n";

    appendFileSync(path.join(this.dir, `app-${date}.jsonl`), line);

    if (entry.level === "ERROR") {
      appendFileSync(path.join(this.dir, `error-${date}.jsonl`), line);
    }
  }
}
