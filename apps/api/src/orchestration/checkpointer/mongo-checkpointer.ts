import mongoose from "mongoose";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { logger } from "../../lib/logger.js";

/**
 * MongoDB-backed checkpointer. `threadId = jobId`, so a worker crash mid-run
 * resumes from the last committed node instead of re-running (and re-charging)
 * earlier provider calls. If the optional checkpoint package isn't installed,
 * we degrade to no checkpointing (runs still work, just not resumable).
 */
export async function createCheckpointer() {
  try {
    // mongoose bundles its own mongodb copy; cast across the duplicate type.
    const client = mongoose.connection.getClient() as never;
    return new MongoDBSaver({ client, dbName: mongoose.connection.name });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "checkpointer unavailable — runs will not be resumable",
    );
    return undefined;
  }
}
