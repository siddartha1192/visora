import path from "node:path";
import { AppLogger } from "./app-logger.js";
import { FileTransport } from "./transports/file.transport.js";

export type { LogEntry, LogLevel, LogTransport, UserContext } from "./types.js";
export { AppLogger } from "./app-logger.js";
export { FileTransport } from "./transports/file.transport.js";

const LOG_DIR = path.resolve(process.cwd(), "logs");

/**
 * Process-wide singleton. Import `appLog` anywhere to emit structured logs.
 *
 * To add a new transport (e.g. MongoDB, S3):
 *   1. Create a class implementing LogTransport in ./transports/
 *   2. Instantiate it below alongside FileTransport
 *
 * Example:
 *   new AppLogger([new FileTransport(LOG_DIR), new MongoTransport(db)])
 */
export const appLog = new AppLogger([new FileTransport(LOG_DIR)]);
