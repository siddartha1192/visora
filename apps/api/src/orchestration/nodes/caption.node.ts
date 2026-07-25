/**
 * FILE: caption.node.ts
 * Step 4 of the pipeline — writes the caption that will appear on the social post.
 * Three modes:
 *  - User supplied a caption → pass it through unchanged
 *  - User asked AI to generate one → call GPT with the prompt/instructions/context as seed
 *  - Neither → leave caption empty
 */
import { defineNode } from "../context.js";
import type { NodeReturn } from "../context.js";

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
      logMessage: "Caption passed through (user-supplied)",
      logData: { generated: false, hashtagCount: (req.hashtags ?? []).length },
    } satisfies NodeReturn;
  }

  if (!req?.generate) {
    return {
      caption: { text: req?.text ?? "", hashtags: req?.hashtags ?? [], generated: false },
      logMessage: "Caption skipped — no generate flag",
      logData: { generated: false },
    } satisfies NodeReturn;
  }

  // brief is the richest seed for autonomous posts; fall back to workflow-specific fields
  const seed =
    state.input.brief ??
    state.input.prompt ??
    state.input.instructions ??
    state.input.context ??
    "Engaging social media post";

  const lm = ctx.nodeAdapters?.caption?.languageModel ?? ctx.services.languageModel;
  const { value, usage } = await lm.completeJson<{
    caption: string;
    hashtags: string[];
  }>({
    system:
      "You are a senior social media copywriter. Write a concise, brand-safe caption and up to 8 relevant hashtags.\n\n" +
      "CONTENT POLICY — strictly enforced. Never produce content that:\n" +
      "• Is pornographic or sexually explicit\n" +
      "• Is derogatory toward any person or group\n" +
      "• Promotes political parties, electoral candidates, or partisan political messaging\n" +
      "• Expresses bias or discrimination based on gender, caste, religion, race, or ethnicity\n" +
      "• Contains abusive, threatening, or harassing language\n" +
      "If the topic would require violating these policies, return an empty caption with a single hashtag: #NA",
    user: `Topic: ${seed}`,
    schemaHint: '{ "caption": string, "hashtags": string[] }',
  });

  const hashtags = (value.hashtags ?? []).slice(0, 30);
  return {
    caption: {
      text: value.caption ?? "",
      hashtags,
      generated: true,
    },
    usage: [{ node: "caption", ...usage }],
    logMessage: `Caption generated — "${(value.caption ?? "").slice(0, 60)}${(value.caption ?? "").length > 60 ? "…" : ""}"`,
    logData: { generated: true, hashtagCount: hashtags.length, seed: seed.slice(0, 100) },
  } satisfies NodeReturn;
});
