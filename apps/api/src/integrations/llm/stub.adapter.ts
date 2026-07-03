import type {
  EditImageParams,
  GenerateImageParams,
  ImageGenerator,
  ImageResult,
  LanguageModel,
  UsageMeta,
} from "../interfaces/ports.js";

const STUB_USAGE: UsageMeta = { provider: "stub" };

/** A tiny valid 1x1 PNG, scaled conceptually — used as placeholder bytes. */
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMEAYG3v8YwAAAAAElFTkSuQmCC",
  "base64",
);

/**
 * Deterministic offline image generator. Returns a placeholder PNG so the
 * generation + enhancement workflows complete end-to-end without an API key.
 */
export class StubImageGenerator implements ImageGenerator {
  readonly name = "stub";

  async generate(params: GenerateImageParams): Promise<ImageResult> {
    return {
      bytes: PLACEHOLDER_PNG,
      mime: "image/png",
      width: 1024,
      height: 1024,
      revisedPrompt: `[stub] ${params.prompt}`,
      usage: { ...STUB_USAGE, imagesGenerated: 1 },
    };
  }

  async edit(params: EditImageParams): Promise<ImageResult> {
    return {
      bytes: params.source.byteLength ? params.source : PLACEHOLDER_PNG,
      mime: params.sourceMime || "image/png",
      width: 1024,
      height: 1024,
      revisedPrompt: `[stub edit] ${params.instructions}`,
      usage: { ...STUB_USAGE, imagesGenerated: 1 },
    };
  }
}

/** Deterministic offline LLM: keyword extraction + caption authoring heuristics. */
export class StubLanguageModel implements LanguageModel {
  readonly name = "stub";

  async complete(args: { system: string; user: string }): Promise<{
    text: string;
    usage: UsageMeta;
  }> {
    return { text: `[stub caption] ${args.user.slice(0, 120)}`, usage: STUB_USAGE };
  }

  async completeJson<T>(args: {
    system: string;
    user: string;
    schemaHint: string;
  }): Promise<{ value: T; usage: UsageMeta }> {
    // Heuristic keyword extraction so the stock workflow has something to search.
    const keywords = Array.from(
      new Set(
        args.user
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 3),
      ),
    ).slice(0, 5);
    return { value: { keywords } as unknown as T, usage: STUB_USAGE };
  }
}
