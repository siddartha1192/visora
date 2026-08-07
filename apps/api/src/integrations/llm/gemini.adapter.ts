import { GoogleGenerativeAI } from "@google/generative-ai";
import { ProviderError } from "../../lib/errors.js";
import type {
  EditImageParams,
  GenerateImageParams,
  ImageGenerator,
  ImageResult,
  LanguageModel,
  UsageMeta,
} from "../interfaces/ports.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function extractImagePart(
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>,
): { mimeType: string; data: string } | null {
  for (const part of parts) {
    if (part.inlineData?.data) return part.inlineData;
  }
  return null;
}

// ── GeminiImageGenerator ─────────────────────────────────────────────────────

/**
 * Implements ImageGenerator using Gemini Flash image generation
 * (e.g. gemini-2.0-flash-preview-image-generation).
 * Supports both text→image (generate) and image+instruction→image (edit).
 */
export class GeminiImageGenerator implements ImageGenerator {
  readonly name = "google";
  private client: GoogleGenerativeAI;
  private imageModel: string;

  constructor(opts: { apiKey: string; imageModel?: string }) {
    this.client = new GoogleGenerativeAI(opts.apiKey);
    this.imageModel = opts.imageModel ?? "gemini-2.0-flash-preview-image-generation";
  }

  async generate(params: GenerateImageParams): Promise<ImageResult> {
    try {
      const model = this.client.getGenerativeModel({
        model: this.imageModel,
        // @ts-expect-error — responseModalities is in the API but not yet typed in the SDK
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      });

      const result = await model.generateContent(params.prompt);
      const parts = result.response.candidates?.[0]?.content?.parts ?? [];
      const img = extractImagePart(parts as Parameters<typeof extractImagePart>[0]);
      if (!img) throw new Error("Gemini returned no image data");

      const bytes = Buffer.from(img.data, "base64");
      const mime = img.mimeType as "image/png" | "image/jpeg";

      const usage: UsageMeta = {
        provider: this.name,
        model: this.imageModel,
        imagesGenerated: 1,
        promptTokens: result.response.usageMetadata?.promptTokenCount,
        completionTokens: result.response.usageMetadata?.candidatesTokenCount,
      };

      return { bytes, mime, width: 1024, height: 1024, usage };
    } catch (err) {
      throw new ProviderError("google", (err as Error).message);
    }
  }

  async edit(params: EditImageParams): Promise<ImageResult> {
    try {
      const model = this.client.getGenerativeModel({
        model: this.imageModel,
        // @ts-expect-error — responseModalities is in the API but not yet typed in the SDK
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      });

      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              { text: params.instructions },
              {
                inlineData: {
                  mimeType: params.sourceMime as "image/png" | "image/jpeg",
                  data: params.source.toString("base64"),
                },
              },
            ],
          },
        ],
      });

      const parts = result.response.candidates?.[0]?.content?.parts ?? [];
      const img = extractImagePart(parts as Parameters<typeof extractImagePart>[0]);
      if (!img) throw new Error("Gemini returned no image data for edit");

      const bytes = Buffer.from(img.data, "base64");
      const mime = img.mimeType as "image/png" | "image/jpeg";

      return {
        bytes,
        mime,
        width: 1024,
        height: 1024,
        usage: {
          provider: this.name,
          model: this.imageModel,
          imagesGenerated: 1,
          promptTokens: result.response.usageMetadata?.promptTokenCount,
          completionTokens: result.response.usageMetadata?.candidatesTokenCount,
        },
      };
    } catch (err) {
      throw new ProviderError("google", (err as Error).message);
    }
  }
}

// ── GeminiLanguageModel ───────────────────────────────────────────────────────

/**
 * Implements LanguageModel using Gemini text models
 * (e.g. gemini-1.5-flash, gemini-2.0-flash).
 */
export class GeminiLanguageModel implements LanguageModel {
  readonly name = "google";
  private client: GoogleGenerativeAI;
  private chatModel: string;

  constructor(opts: { apiKey: string; chatModel?: string }) {
    this.client = new GoogleGenerativeAI(opts.apiKey);
    this.chatModel = opts.chatModel ?? "gemini-1.5-flash";
  }

  async complete(args: { system: string; user: string }): Promise<{
    text: string;
    usage: UsageMeta;
  }> {
    try {
      const model = this.client.getGenerativeModel({
        model: this.chatModel,
        systemInstruction: args.system,
      });
      const result = await model.generateContent(args.user);
      return {
        text: result.response.text(),
        usage: {
          provider: this.name,
          model: this.chatModel,
          promptTokens: result.response.usageMetadata?.promptTokenCount,
          completionTokens: result.response.usageMetadata?.candidatesTokenCount,
        },
      };
    } catch (err) {
      throw new ProviderError("google", (err as Error).message);
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
      throw new ProviderError("google", "model returned non-JSON output");
    }
  }
}
