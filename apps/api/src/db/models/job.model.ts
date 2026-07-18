import { Schema, model, type InferSchemaType, type Types } from "mongoose";
import { JOB_STATES } from "@visora/shared";

const jobSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
    postId: { type: Schema.Types.ObjectId, ref: "Post", required: true, index: true },
    type: { type: String, default: "process_post" },
    state: { type: String, enum: JOB_STATES, default: "pending", index: true },
    bullJobId: { type: String },
    runAt: { type: Date },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    /** LangGraph checkpoint id, set so a retried run resumes mid-graph. */
    checkpointId: { type: String },
    lastError: { type: String },
  },
  { timestamps: true },
);

jobSchema.index({ state: 1, runAt: 1 });

export type JobDoc = InferSchemaType<typeof jobSchema> & {
  _id: Types.ObjectId;
};

export const JobModel = model("Job", jobSchema);
