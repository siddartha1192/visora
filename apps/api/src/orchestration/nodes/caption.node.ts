import { defineNode } from "../context.js";

/**
 * Optional caption authoring. If the user supplied caption text we pass it
 * through; if they asked the agent to generate one (or an AI workflow left it
 * blank), we call the LanguageModel port to write a platform-appropriate
 * caption + hashtags from the original prompt/instructions/context.
 */
export const captionNode = defineNode("caption", async (state, ctx) => {
  const req = state.captionRequest;

  if (req?.text && !req.generate) {
    return {
      caption: { text: req.text, hashtags: req.hashtags ?? [], generated: false },
    };
  }

  if (!req?.generate) {
    // Nothing to do — leave caption empty.
    return { caption: { text: req?.text ?? "", hashtags: req?.hashtags ?? [], generated: false } };
  }

  const seed =
    state.input.prompt ??
    state.input.instructions ??
    state.input.context ??
    "Engaging social media post";

  const { value, usage } = await ctx.services.languageModel.completeJson<{
    caption: string;
    hashtags: string[];
  }>({
    system:
      "You are a senior social media copywriter. Write a concise, brand-safe caption and up to 8 relevant hashtags.",
    user: `Topic: ${seed}`,
    schemaHint: '{ "caption": string, "hashtags": string[] }',
  });

  return {
    caption: {
      text: value.caption ?? "",
      hashtags: (value.hashtags ?? []).slice(0, 30),
      generated: true,
    },
    usage: [{ node: "caption", provider: usage.provider, model: usage.model }],
  };
});
