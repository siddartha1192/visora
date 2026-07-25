/**
 * FILE: moderation.node.ts
 * Content policy gate — runs immediately after ingest, before any LLM or image
 * provider is called.
 *
 * Collects every user-supplied text field present in the graph state and passes
 * them all to the OpenAI Moderation API in a single batch call. Throws on any
 * policy violation, which causes defineNode to write a "failed" AgentLog entry
 * and the BullMQ runner to mark the post as failed with the violation reason.
 *
 * A second pass runs after the planner node emits derived prompts/instructions
 * so that content the LLM synthesised from a benign-looking brief is also screened
 * before it reaches image generators or caption writers.
 */
import { defineNode } from "../context.js";
import type { NodeReturn } from "../context.js";
import { moderateTexts, ContentPolicyViolationError, HIGH_RISK_KEYWORDS } from "../../lib/moderation.js";

/**
 * Collects all user-supplied and planner-derived text fields present in state
 * and checks them against the platform content policy. Fails the pipeline if any
 * text violates policy — prevents prohibited content from reaching AI providers.
 */
export const moderationNode = defineNode("moderation", async (state) => {
  const textsToScreen = [
    // Direct user inputs
    state.input?.brief,
    state.input?.prompt,
    state.input?.instructions,
    state.input?.context,
    state.input?.enhanceInstructions,
    // User-supplied caption (not AI-generated — goes straight to the publisher)
    state.captionRequest?.text,
  ];

  // Keyword pre-filter: catch high-risk terms the Moderation API scoring
  // threshold consistently misses (occupational/biographical phrasing).
  const allText = textsToScreen
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .join(" ");
  if (HIGH_RISK_KEYWORDS.some((re) => re.test(allText))) {
    throw new Error("[content-policy] Your content contains terms that are not permitted on this platform. Please revise your content and try again.");
  }

  try {
    await moderateTexts(textsToScreen);
  } catch (err) {
    if (err instanceof ContentPolicyViolationError) {
      // Re-throw with a message that the pipeline runner stores as lastError
      throw new Error(`[content-policy] ${err.userMessage}`);
    }
    throw err;
  }

  const checkedCount = textsToScreen.filter(
    (t) => typeof t === "string" && t.trim().length > 0,
  ).length;

  return {
    logMessage: `Content policy check passed — ${checkedCount} field(s) screened`,
    logData: { checkedFields: checkedCount },
  } satisfies NodeReturn;
});
