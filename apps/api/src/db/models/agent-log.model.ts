import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { AGENT_LOG_STATUSES, AGENT_NODES } from "@visora/shared";

/**
 * One document per node execution within a graph run. This is the audit +
 * debug spine: replaying `agentlogs.find({ threadId }).sort({ sequence })`
 * reconstructs exactly what each agent did, with provider usage + timing.
 */
const agentLogSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
    postId: { type: Schema.Types.ObjectId, ref: "Post", required: true, index: true },
    jobId: { type: Schema.Types.ObjectId, ref: "Job" },
    threadId: { type: String, required: true, index: true },
    node: { type: String, enum: AGENT_NODES, required: true },
    sequence: { type: Number, required: true },
    status: { type: String, enum: AGENT_LOG_STATUSES, required: true },
    input: { type: Schema.Types.Mixed },
    output: { type: Schema.Types.Mixed },
    provider: {
      name: { type: String },
      model: { type: String },
      requestId: { type: String },
    },
    usage: {
      promptTokens: { type: Number },
      completionTokens: { type: Number },
      imagesGenerated: { type: Number },
      costUsd: { type: Number },
    },
    durationMs: { type: Number },
    /** Human-readable summary for the UI log viewer. */
    message: { type: String },
    /** Small structured metadata for the UI (e.g. resolved workflow, platform list). */
    data: { type: Schema.Types.Mixed },
    error: {
      message: { type: String },
      code: { type: String },
      stack: { type: String },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

agentLogSchema.index({ threadId: 1, sequence: 1 });
agentLogSchema.index({ postId: 1, createdAt: 1 });

export type AgentLogDoc = InferSchemaType<typeof agentLogSchema> & {
  _id: Types.ObjectId;
};

export const AgentLogModel = model("AgentLog", agentLogSchema);
