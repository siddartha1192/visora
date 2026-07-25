import { Schema, model, type InferSchemaType } from "mongoose";

// Which LLM-capable nodes can be assigned an LlmConfig.
export const LLM_NODES = ["planner", "caption", "generation", "enhancement"] as const;
export type LlmNode = (typeof LLM_NODES)[number];

// Singleton document — always upserted with singletonKey = "global".
const nodeConfigSchema = new Schema(
  {
    singletonKey: { type: String, default: "global", unique: true },
    assignments: {
      planner:     { type: Schema.Types.ObjectId, ref: "LlmConfig", default: null },
      caption:     { type: Schema.Types.ObjectId, ref: "LlmConfig", default: null },
      generation:  { type: Schema.Types.ObjectId, ref: "LlmConfig", default: null },
      enhancement: { type: Schema.Types.ObjectId, ref: "LlmConfig", default: null },
    },
  },
  { timestamps: true },
);

export type NodeConfigDoc = InferSchemaType<typeof nodeConfigSchema>;
export const NodeConfigModel = model("NodeConfig", nodeConfigSchema);
