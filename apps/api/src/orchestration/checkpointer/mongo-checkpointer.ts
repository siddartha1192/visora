/**
 * FILE: mongo-checkpointer.ts
 * Provides crash-recovery for the pipeline by saving state to MongoDB after each node completes.
 *
 * How it works:
 *  - Each run is identified by a thread_id (= jobId)
 *  - If the worker crashes mid-run, the next retry resumes from the last saved node
 *    instead of re-running (and re-charging) earlier provider calls like DALL·E or Cloudinary
 *
 * Degrades gracefully: if the checkpoint package isn't installed, returns undefined
 * and the pipeline runs normally — just without the ability to resume after a crash.
 */
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
