/**
 * Platform content policy enforcement.
 *
 * Uses the OpenAI Moderation API to screen text for:
 *   - Pornographic / sexually explicit content
 *   - Hate speech (covers race, gender, caste, religion, ethnicity, nationality)
 *   - Abusive / harassing / threatening language
 *   - Violence (graphic or threatening)
 *   - Self-harm content
 *
 * Political content is handled via system-prompt hardening in the LLM nodes
 * (planner, caption, generation) rather than at the API level to avoid false
 * positives on legitimate business content that mentions political topics.
 *
 * If the Moderation API is unreachable, calls are allowed through with a warning
 * so a transient outage never blocks legitimate users. The LLM system-prompt
 * guardrails remain active as a secondary defence in that scenario.
 */
import OpenAI from "openai";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

// ── Keyword pre-filter ────────────────────────────────────────────────────────
// Terms the Moderation API's scoring threshold consistently misses because they
// read as occupational/biographical text rather than explicit descriptions.
// Exported so all three moderation layers (HTTP boundary, pipeline node,
// generation node) share the same list.
export const HIGH_RISK_KEYWORDS = [
  /\bporn\s*star\b/i,
  /\bpornstar\b/i,
  /\bxxx\b/i,
  /\bnude\b/i,
  /\bnaked\b/i,
  /\bsex\s*tape\b/i,
  /\bonlyfans\b/i,
  /\bescort\b/i,
];

// ── Violation error ───────────────────────────────────────────────────────────

export class ContentPolicyViolationError extends Error {
  readonly code = "CONTENT_POLICY_VIOLATION";
  readonly statusCode = 422;

  constructor(
    public readonly userMessage: string,
    public readonly flaggedCategories: string[],
  ) {
    super(userMessage);
    this.name = "ContentPolicyViolationError";
  }
}

// ── Category label map ────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  "sexual":                  "explicit or pornographic content",
  "sexual/minors":           "sexual content involving minors",
  "hate":                    "hate speech based on race, gender, caste, religion, or ethnicity",
  "hate/threatening":        "threatening hate speech",
  "harassment":              "abusive or harassing language",
  "harassment/threatening":  "threats or threatening language",
  "violence":                "violent content",
  "violence/graphic":        "graphic violent content",
  "self-harm":               "self-harm content",
  "self-harm/intent":        "self-harm intent",
  "self-harm/instructions":  "self-harm instructions",
  "illicit":                 "illicit content",
  "illicit/violent":         "illicit violent content",
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Screens one or more text strings against the platform content policy.
 * Throws `ContentPolicyViolationError` on the first batch that is flagged.
 * All non-empty strings are sent in a single API call (max 32 per request).
 *
 * Safe to call with an empty array — returns immediately.
 * Logs a warning and returns without throwing if the API is unavailable.
 */
export async function moderateTexts(texts: (string | null | undefined)[]): Promise<void> {
  const nonEmpty = texts.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  if (nonEmpty.length === 0) return;

  if (!env.OPENAI_API_KEY) {
    logger.warn("content-policy: moderation skipped — OPENAI_API_KEY not configured");
    return;
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  let response: Awaited<ReturnType<typeof client.moderations.create>>;
  try {
    // Batch all texts in one request (API limit: 32 strings)
    response = await client.moderations.create({ input: nonEmpty.slice(0, 32) });
  } catch (err) {
    logger.warn({ err }, "content-policy: Moderation API unreachable — content allowed through");
    return;
  }

  // Collect all flagged categories across every result in the batch
  const allFlagged = new Set<string>();
  for (const result of response.results) {
    if (!result.flagged) continue;
    for (const [category, isFlagged] of Object.entries(result.categories)) {
      if (isFlagged) allFlagged.add(category);
    }
  }

  if (allFlagged.size === 0) return;

  const labels = [...allFlagged].map((c) => CATEGORY_LABELS[c] ?? c);
  const violations = labels.join("; ");

  logger.warn({ flaggedCategories: [...allFlagged] }, "content-policy: content flagged");

  throw new ContentPolicyViolationError(
    `Your content was flagged for: ${violations}. ` +
    `This platform does not allow pornographic, hateful, derogatory, abusive, or ` +
    `discriminatory content (including based on gender, caste, religion, or ethnicity). ` +
    `Please revise your content and try again.`,
    [...allFlagged],
  );
}
