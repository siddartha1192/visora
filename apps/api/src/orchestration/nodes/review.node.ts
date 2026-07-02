/**
 * FILE: review.node.ts
 * Human-in-the-loop approval gate. Runs after the caption is ready but before publish.
 *
 * First entry:
 *   - Updates Post status to "pending_review" so the UI can show a Review button
 *   - Calls interrupt() — the LangGraph checkpointer freezes the full graph state
 *   - graph.invoke() returns early; the worker job completes with no error
 *
 * On resume (user clicks Approve or Reject in the UI):
 *   - The API calls graph.invoke(new Command({ resume: { approved } }), { thread_id })
 *   - interrupt() returns the resume value { approved: boolean }
 *   - Node sets approvalStatus so the downstream conditional edge routes correctly
 */
import { interrupt } from "@langchain/langgraph";
import { Types } from "mongoose";
import { PostModel } from "../../db/models/index.js";
import { defineNode } from "../context.js";

export const reviewNode = defineNode("review", async (state) => {
  const assetId = (state.processedAsset ?? state.rawAsset)?.assetId;

  // Save the primary asset ID now so the review modal can display the image.
  // persist.node.ts normally does this, but it hasn't run yet at this point.
  await PostModel.updateOne(
    { _id: new Types.ObjectId(state.postId) },
    {
      $set: {
        status: "pending_review",
        ...(assetId ? { primaryAssetId: new Types.ObjectId(assetId) } : {}),
      },
    },
  );

  // Pause — the graph state is frozen in the checkpointer.
  // The placeholder value { approved: false } is the interrupt payload sent to the caller;
  // the actual decision arrives via Command({ resume: { approved: true|false } }).
  const decision = interrupt<{ approved: boolean }>({ approved: false });

  const approved = decision?.approved ?? false;

  // Restore "processing" status so downstream persist doesn't overwrite with stale "pending_review".
  await PostModel.updateOne(
    { _id: new Types.ObjectId(state.postId) },
    { $set: { status: "processing" } },
  );

  return {
    approvalStatus: approved ? "approved" : "rejected",
    status: "running",
  };
});
