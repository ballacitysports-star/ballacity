/**
 * The single AI provider interface every feature in the app talks to.
 *
 * Nothing outside `src/lib/ai/` calls a model endpoint directly. Swapping
 * providers means adding another implementation of this interface — call sites
 * never change. Keys are read from the server environment by the implementation
 * and are never part of a request object, a result, or an error.
 */

export type AiMessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

export type AiTokenUsage = { inputTokens: number; outputTokens: number };

export type AiTextResult = { text: string; model: string; usage: AiTokenUsage };
export type AiStructuredResult<T = unknown> = { data: T; model: string; usage: AiTokenUsage };

export type TextVerdict = "allow" | "review" | "block";

export type AiTextModerationResult = {
  verdict: TextVerdict;
  categories: string[];
  reason: string | null;
  model: string;
  usage: AiTokenUsage;
};

export type AiImageModerationResult = {
  safe: boolean;
  label: string;
  categories: string[];
  reason: string | null;
  model: string;
  usage: AiTokenUsage;
};

export type GenerateTextRequest = {
  system: string;
  prompt: string;
  model?: string;
  /** Raw parts, when the prompt is multimodal. Overrides `prompt` when present. */
  parts?: AiMessagePart[];
};

export type GenerateStructuredRequest = GenerateTextRequest;

export type AnalyzeImagesRequest = {
  system: string;
  prompt: string;
  /** Data URLs or signed URLs the caller has already authorized. */
  images: string[];
  model?: string;
};

export type TranscribeAudioRequest = {
  system: string;
  prompt: string;
  /** Base64 audio payload, no `data:` prefix. */
  audio: string;
  format: string;
  model?: string;
};

export interface AiProvider {
  readonly name: string;

  generateText(req: GenerateTextRequest): Promise<AiTextResult>;
  generateStructured<T = unknown>(req: GenerateStructuredRequest): Promise<AiStructuredResult<T>>;
  analyzeImages<T = unknown>(req: AnalyzeImagesRequest): Promise<AiStructuredResult<T>>;
  transcribeAudio<T = unknown>(req: TranscribeAudioRequest): Promise<AiStructuredResult<T>>;

  moderateText(req: { text: string; context?: string }): Promise<AiTextModerationResult>;
  moderateImage(req: { imageUrl: string }): Promise<AiImageModerationResult>;

  /** Declared for Phase 4. Both currently throw FEATURE_DISABLED. */
  generateImage(req: { prompt: string; model?: string }): Promise<never>;
  enhanceImage(req: { imageUrl: string; prompt: string; model?: string }): Promise<never>;
}
