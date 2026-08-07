/**
 * Resolves per-node LLM adapters from the admin-configured NodeConfig document.
 * Called once per pipeline run so that changes saved in the admin panel take
 * effect on the next run without requiring an API restart.
 */
import type { Types } from "mongoose";
import { NodeConfigModel, LlmConfigModel } from "../db/models/index.js";
import {
  OpenAILanguageModel,
  OpenAIImageGenerator,
} from "../integrations/llm/openai.adapter.js";
import {
  GeminiLanguageModel,
  GeminiImageGenerator,
} from "../integrations/llm/gemini.adapter.js";
import type {
  ImageGenerator,
  LanguageModel,
} from "../integrations/interfaces/ports.js";

export interface NodeAdapters {
  languageModel?: LanguageModel;
  imageGenerator?: ImageGenerator;
}

/** Maps node key → adapters built from the DB-configured LLM. */
export type NodeAdaptersMap = Partial<Record<string, NodeAdapters>>;

const TEXT_NODES = new Set(["planner", "caption"]);
const IMAGE_NODES = new Set(["generation", "enhancement"]);

function buildAdapters(
  provider: string,
  apiKey: string,
  chatModel: string | undefined,
  imageModel: string | undefined,
  nodeKey: string,
): NodeAdapters {
  if (provider === "openai") {
    return {
      languageModel: TEXT_NODES.has(nodeKey)
        ? new OpenAILanguageModel({ apiKey, chatModel })
        : undefined,
      imageGenerator: IMAGE_NODES.has(nodeKey)
        ? new OpenAIImageGenerator({ apiKey, imageModel })
        : undefined,
    };
  }
  if (provider === "google") {
    return {
      languageModel: TEXT_NODES.has(nodeKey)
        ? new GeminiLanguageModel({ apiKey, chatModel })
        : undefined,
      imageGenerator: IMAGE_NODES.has(nodeKey)
        ? new GeminiImageGenerator({ apiKey, imageModel })
        : undefined,
    };
  }
  return {};
}

/**
 * Reads the singleton NodeConfig document and the referenced LlmConfig records,
 * then builds a map of node → { languageModel?, imageGenerator? }.
 *
 * Returns an empty map when no NodeConfig exists or no assignments are set,
 * so callers can always fall back to the env-var container adapters.
 */
export async function resolveNodeAdapters(): Promise<NodeAdaptersMap> {
  const nodeConfig = await NodeConfigModel.findOne({ singletonKey: "global" }).lean();
  if (!nodeConfig) return {};

  const assignments = nodeConfig.assignments as Record<
    string,
    Types.ObjectId | null | undefined
  >;

  // Collect unique LlmConfig IDs to fetch them in one query
  const ids = Object.values(assignments)
    .filter((v): v is Types.ObjectId => v != null)
    .map((id) => id.toString());

  if (ids.length === 0) return {};

  const configs = await LlmConfigModel.find({
    _id: { $in: ids },
    isActive: true,
  }).lean();

  const configById = new Map(configs.map((c) => [c._id.toString(), c]));

  const result: NodeAdaptersMap = {};
  for (const [node, llmId] of Object.entries(assignments)) {
    if (!llmId) continue;
    const cfg = configById.get(llmId.toString());
    if (!cfg) continue;
    result[node] = buildAdapters(
      cfg.provider,
      cfg.apiKey,
      cfg.chatModel ?? undefined,
      cfg.imageModel ?? undefined,
      node,
    );
  }

  return result;
}
