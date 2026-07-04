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
 *   - The API calls graph.invoke(new Command({ resume: decision }), { thread_id })
 *   - interrupt() returns the full decision object
 *   - If the user changed the publish schedule in the modal, it is applied here
 *   - approvalStatus routes the conditional edge to publish or persist
 */
import { interrupt } from "@langchain/langgraph";
import { Types } from "mongoose";
import { PostModel } from "../../db/models/index.js";
import { logger } from "../../lib/logger.js";
import { defineNode } from "../context.js";

interface ReviewDecision {
  approved: boolean;
  /** ISO 8601 UTC publish time chosen in the review modal (overrides original). */
  scheduledAt?: string | null;
  /** Publish mode chosen in the review modal (overrides original). */
  scheduleMode?: "instant" | "scheduled" | null;
}

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
  const decision = interrupt<ReviewDecision>({ approved: false });

  const approved = decision?.approved ?? false;

  // ── Schedule override ────────────────────────────────────────────────────
  // The review modal lets the user pick a publish time (or switch to instant).
  // Apply any change before the downstream routing edge reads scheduleMode.
  let newScheduleMode = state.scheduleMode;

  if (decision.scheduleMode) {
    newScheduleMode = decision.scheduleMode;
  }

  if (newScheduleMode === "scheduled" && decision.scheduledAt) {
    try {
      const runAt = new Date(decision.scheduledAt);
      if (!isNaN(runAt.getTime()) && runAt > new Date()) {
        await PostModel.updateOne(
          { _id: new Types.ObjectId(state.postId) },
          { $set: { "schedule.mode": "scheduled", "schedule.runAt": runAt } },
        );
        logger.info(
          { postId: state.postId, runAt: runAt.toISOString() },
          "review: publish schedule set/updated",
        );
      }
    } catch (err) {
      logger.warn({ postId: state.postId, err }, "review: could not parse scheduledAt");
    }
  } else if (newScheduleMode === "instant") {
    // User switched from scheduled → instant: clear the runAt so persist uses instant routing.
    await PostModel.updateOne(
      { _id: new Types.ObjectId(state.postId) },
      { $set: { "schedule.mode": "instant" }, $unset: { "schedule.runAt": "" } },
    );
  }

  // Restore "processing" status so downstream persist doesn't overwrite with stale state.
  await PostModel.updateOne(
    { _id: new Types.ObjectId(state.postId) },
    { $set: { status: "processing" } },
  );

  return {
    approvalStatus: approved ? "approved" : "rejected",
    scheduleMode: newScheduleMode,
    status: "running",
  };
});
