import type { FastifyRequest, FastifyReply } from "fastify";
import OpenAI from "openai";
import { env } from "../../config/env.js";
import { ok } from "../reply.js";

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const SYSTEM = `You are an expert at writing AI image-generation prompts.
Given a user's rough idea, rewrite it as a single, detailed, evocative prompt that produces a stunning image.
Add: visual style, lighting, mood, composition, and any details that improve image quality.
Return ONLY the refined prompt — no explanation, no quotation marks, no preamble.`;

export async function refinePrompt(req: FastifyRequest, reply: FastifyReply) {
  const { prompt } = req.body as { prompt: string };

  const response = await client.chat.completions.create({
    model: env.OPENAI_TEXT_MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt },
    ],
    max_tokens: 300,
    temperature: 0.7,
  });

  const refined = response.choices[0]?.message?.content?.trim() ?? prompt;
  return ok(reply, { refined });
}
