import pino, { type LoggerOptions } from "pino";
import { env, isProd } from "../config/env.js";

/** Shared pino options — reused for the standalone logger AND Fastify's logger. */
export const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
        },
      }),
  base: { service: "visora-api" },
};

/** Standalone logger for the worker, services, and anything outside HTTP. */
export const logger = pino(loggerOptions);

export type Logger = typeof logger;
