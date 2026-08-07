import OpenAI, { toFile } from "openai";
import { env } from "../../config/env.js";
import { ProviderError } from "../../lib/errors.js";
import { fetchImage } from "../../lib/fetch-image.js";
import { withRetry } from "../../lib/retry.js";
import type {
  EditImageParams,
  GenerateImageParams,
  ImageGenerator,
  ImageResult,
  LanguageModel,
  UsageMeta,
} from "../interfaces/ports.js";

// Pricing as of 2025 — input/output per 1 million tokens for text models,
// flat per-image rate for image models. Update when OpenAI changes pricing.
const TEXT_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4o":              { input:  2.50, output: 10.00 },
  "gpt-4o-mini":         { input:  0.15, output:  0.60 },
  "gpt-4-turbo":         { input: 10.00, output: 30.00 },
  "gpt-4-turbo-preview": { input: 10.00, output: 30.00 },
  "gpt-4":               { input: 30.00, output: 60.00 },
  "gpt-3.5-turbo":       { input:  0.50, output:  1.50 },
};

// Cost per generated image (standard quality, 1024×1024)
const IMAGE_PRICES: Record<string, number> = {
  "gpt-image-1": 0.040,
  "dall-e-3":    0.040,
  "dall-e-2":    0.020,
};

function calcTextCost(model: string, promptTokens = 0, completionTokens = 0): number | undefined {
  const price = TEXT_PRICES[model];
  if (!price) return undefined;
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
}

function calcImageCost(model: string, count = 1): number | undefined {
  const price = IMAGE_PRICES[model];
  if (!price) return undefined;
  return price * count;
}

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
  private imageModel: string;

  constructor(opts?: { apiKey?: string; imageModel?: string }) {
    this.client = new OpenAI({ apiKey: opts?.apiKey ?? env.OPENAI_API_KEY });
    this.imageModel = opts?.imageModel ?? env.OPENAI_IMAGE_MODEL;
  }

  async generate(params: GenerateImageParams): Promise<ImageResult> {
    const size = params.size ?? "1024x1024";
    try {
      const res = await withRetry(
        () =>
          this.client.images.generate({
            model: this.imageModel,
            prompt: params.prompt,
            size,
            n: 1,
          } as Parameters<typeof this.client.images.generate>[0]),
        { label: "openai.images.generate" },
      );
      const first = res.data?.[0];
      if (!first) throw new Error("no image returned");

      // gpt-image-1 always returns b64_json; dall-e-3 defaults to a URL.
      let bytes: Buffer;
      let mime = "image/png";
      if (first.b64_json) {
        bytes = Buffer.from(first.b64_json, "base64");
      } else if (first.url) {
        const fetched = await fetchImage(first.url);
        bytes = fetched.bytes;
        mime = fetched.mime;
      } else {
        throw new Error("no image data in response");
      }

      const dims = parseSize(size);
      const usage: UsageMeta = {
        provider: this.name,
        model: this.imageModel,
        imagesGenerated: 1,
        costUsd: calcImageCost(this.imageModel, 1),
      };
      return {
        bytes,
        mime,
        ...dims,
        revisedPrompt: first.revised_prompt ?? undefined,
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
            model: this.imageModel,
            image,
            prompt: params.instructions,
          } as Parameters<typeof this.client.images.edit>[0]),
        { label: "openai.images.edit" },
      );
      const first = res.data?.[0];
      if (!first) throw new Error("no image returned");

      let bytes: Buffer;
      let mime = "image/png";
      if (first.b64_json) {
        bytes = Buffer.from(first.b64_json, "base64");
      } else if (first.url) {
        const fetched = await fetchImage(first.url);
        bytes = fetched.bytes;
        mime = fetched.mime;
      } else {
        throw new Error("no image data in response");
      }

      return {
        bytes,
        mime,
        width: 1024,
        height: 1024,
        usage: {
          provider: this.name,
          model: this.imageModel,
          imagesGenerated: 1,
          costUsd: calcImageCost(this.imageModel, 1),
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
  private chatModel: string;

  constructor(opts?: { apiKey?: string; chatModel?: string }) {
    this.client = new OpenAI({ apiKey: opts?.apiKey ?? env.OPENAI_API_KEY });
    this.chatModel = opts?.chatModel ?? env.OPENAI_TEXT_MODEL;
  }

  async complete(args: { system: string; user: string }): Promise<{
    text: string;
    usage: UsageMeta;
  }> {
    try {
      const res = await withRetry(
        () =>
          this.client.chat.completions.create({
            model: this.chatModel,
            messages: [
              { role: "system", content: args.system },
              { role: "user", content: args.user },
            ],
          }),
        { label: "openai.chat" },
      );
      const promptTokens = res.usage?.prompt_tokens;
      const completionTokens = res.usage?.completion_tokens;
      return {
        text: res.choices[0]?.message?.content ?? "",
        usage: {
          provider: this.name,
          model: this.chatModel,
          promptTokens,
          completionTokens,
          costUsd: calcTextCost(this.chatModel, promptTokens, completionTokens),
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
