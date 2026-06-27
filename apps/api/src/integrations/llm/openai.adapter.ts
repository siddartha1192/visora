import OpenAI, { toFile } from "openai";
import { env } from "../../config/env.js";
import { ProviderError } from "../../lib/errors.js";
import { withRetry } from "../../lib/retry.js";
import type {
  EditImageParams,
  GenerateImageParams,
  ImageGenerator,
  ImageResult,
  LanguageModel,
  UsageMeta,
} from "../interfaces/ports.js";

function parseSize(size?: string): { width: number; height: number } {
  switch (size) {
    case "1792x1024":
      return { width: 1792, height: 1024 };
    case "1024x1792":
      return { width: 1024, height: 1792 };
    default:
      return { width: 1024, height: 1024 };
  }
}

export class OpenAIImageGenerator implements ImageGenerator {
  readonly name = "openai";
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  async generate(params: GenerateImageParams): Promise<ImageResult> {
    const size = params.size ?? "1024x1024";
    try {
      const res = await withRetry(
        () =>
          this.client.images.generate({
            model: env.OPENAI_IMAGE_MODEL,
            prompt: params.prompt,
            size,
            response_format: "b64_json",
            n: 1,
          }),
        { label: "openai.images.generate" },
      );
      const first = res.data?.[0];
      if (!first?.b64_json) throw new Error("no image returned");
      const bytes = Buffer.from(first.b64_json, "base64");
      const dims = parseSize(size);
      const usage: UsageMeta = {
        provider: this.name,
        model: env.OPENAI_IMAGE_MODEL,
        imagesGenerated: 1,
      };
      return {
        bytes,
        mime: "image/png",
        ...dims,
        revisedPrompt: first.revised_prompt,
        usage,
      };
    } catch (err) {
      throw new ProviderError("openai", (err as Error).message);
    }
  }

  async edit(params: EditImageParams): Promise<ImageResult> {
    try {
      const image = await toFile(params.source, "source.png", {
        type: "image/png",
      });
      const res = await withRetry(
        () =>
          this.client.images.edit({
            model: env.OPENAI_IMAGE_MODEL,
            image,
            prompt: params.instructions,
            response_format: "b64_json",
            ...(params.mask
              ? { mask: undefined as never } // mask wiring left for inpainting phase
              : {}),
          }),
        { label: "openai.images.edit" },
      );
      const first = res.data?.[0];
      if (!first?.b64_json) throw new Error("no image returned");
      const bytes = Buffer.from(first.b64_json, "base64");
      return {
        bytes,
        mime: "image/png",
        width: 1024,
        height: 1024,
        usage: {
          provider: this.name,
          model: env.OPENAI_IMAGE_MODEL,
          imagesGenerated: 1,
        },
      };
    } catch (err) {
      throw new ProviderError("openai", (err as Error).message);
    }
  }
}

export class OpenAILanguageModel implements LanguageModel {
  readonly name = "openai";
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  async complete(args: { system: string; user: string }): Promise<{
    text: string;
    usage: UsageMeta;
  }> {
    try {
      const res = await withRetry(
        () =>
          this.client.chat.completions.create({
            model: env.OPENAI_TEXT_MODEL,
            messages: [
              { role: "system", content: args.system },
              { role: "user", content: args.user },
            ],
          }),
        { label: "openai.chat" },
      );
      return {
        text: res.choices[0]?.message?.content ?? "",
        usage: {
          provider: this.name,
          model: env.OPENAI_TEXT_MODEL,
          promptTokens: res.usage?.prompt_tokens,
          completionTokens: res.usage?.completion_tokens,
        },
      };
    } catch (err) {
      throw new ProviderError("openai", (err as Error).message);
    }
  }

  async completeJson<T>(args: {
    system: string;
    user: string;
    schemaHint: string;
  }): Promise<{ value: T; usage: UsageMeta }> {
    const { text, usage } = await this.complete({
      system: `${args.system}\nRespond with ONLY valid JSON matching: ${args.schemaHint}`,
      user: args.user,
    });
    try {
      const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      return { value: JSON.parse(cleaned) as T, usage };
    } catch {
      throw new ProviderError("openai", "model returned non-JSON output");
    }
  }
}
