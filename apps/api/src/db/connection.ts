import mongoose from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

let connected = false;

export async function connectMongo(): Promise<typeof mongoose> {
  if (connected) return mongoose;
  mongoose.set("strictQuery", true);

  mongoose.connection.on("error", (err) =>
    logger.error({ err }, "mongo connection error"),
  );
  mongoose.connection.on("disconnected", () =>
    logger.warn("mongo disconnected"),
  );

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });
  connected = true;
  logger.info("mongo connected");
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}
