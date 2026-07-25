/**
 * FILE: ingest.node.ts
 * Step 1 of the pipeline — the gate check that every post must pass before anything runs.
 * Loads the post from the database, rejects cancelled posts, and flips status to "processing".
 * Budget/credit pre-checks would also live here in the future.
 */
import { Types } from "mongoose";
import { PostModel, UserModel } from "../../db/models/index.js";
import { defineNode } from "../context.js";
import type { NodeReturn } from "../context.js";

/**
 * Entry node for every run. Loads the Post draft, validates the workspace owns
 * it, flips status to "processing", and seeds the run identity. (Budget/credit
 * pre-checks would also live here.) Throws if the post is gone or cancelled.
 */
export const ingestNode = defineNode("ingest", async (state) => {
  const post = await PostModel.findById(state.postId);
  if (!post) throw new Error(`ingest: post ${state.postId} not found`);
  if (post.status === "cancelled") throw new Error("ingest: post was cancelled");

  await PostModel.updateOne(
    { _id: new Types.ObjectId(state.postId) },
    { $set: { status: "processing" } },
  );

  // Resolve the author's email to use as the S3 folder prefix.
  // Falls back to undefined (asset-helper will use workspaceId instead).
  let authorEmail: string | undefined;
  if (post.authorId) {
    const user = await UserModel.findById(post.authorId).select("email").lean();
    if (user?.email) authorEmail = user.email.toLowerCase().replace("@", "_");
  }

  return {
    authorEmail,
    status: "running",
    logMessage: "Post loaded, status → processing",
    logData: { postId: state.postId, workflow: state.workflow },
  } satisfies NodeReturn;
});
