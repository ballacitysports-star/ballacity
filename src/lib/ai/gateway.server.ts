/**
 * Lovable AI gateway implementation of `AiProvider`.
 *
 * Server-only. The API key is read from the server environment at call time and
 * never logged, returned, stored in `app_settings`, or attached to an error.
 * Provider 429/5xx responses are retried with bounded exponential backoff
 * (3 attempts max); every other status is terminal.
 */

import { AiError, isRetryableStatus, providerErrorFor, toAiError } from "./errors";
import type { AiProviderConfig } from "./config";
import type {
  AiImageModerationResult,
  AiImageResult,
  AiMessagePart,
  AiProvider,
  AiStructuredResult,
  AiTextModerationResult,
  AiTextResult,
  AiTokenUsage,
  AnalyzeImagesRequest,
  EnhanceImageRequest,
  GenerateImageRequest,
  GenerateStructuredRequest,
  GenerateTextRequest,
  TextVerdict,
  TranscribeAudioRequest,
} from "./provider";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MAX_TRIES = 3;
const BASE_BACKOFF_MS = 500;

const MODERATION_SYSTEM = `You are a text safety classifier for a community sports app used by adults and minors.
Respond with ONLY compact JSON: {"verdict":"allow|review|block","categories":string[],"reason":string}
Block: sexual content, sexualization of minors, hate or slurs, threats or violence, harassment, self-harm encouragement, illegal drug or weapon sales, scams, doxxing (addresses, phone numbers, schools), or contact solicitation aimed at minors.
Review: borderline profanity, mild insults, unclear intent.
Allow: ordinary sports talk, hype, stats, team and game commentary.`;

const IMAGE_MODERATION_SYSTEM = `You are an image safety classifier for a community sports app.
Respond with ONLY compact JSON: {"safe":boolean,"label":"safe|nudity|sexual|csam|violence|gore|hate|drugs|weapons|self_harm|spam|illegible","categories":string[],"reason":string}
Mark unsafe when the image contains nudity or sexual content, any sexualized depiction of a minor, graphic violence or gore, hate symbols, drug use, weapons aimed at people, self-harm, or scam/spam advertising.
Ordinary sports, gym, team, venue, portrait and logo imagery is safe.`;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function usageFrom(raw: unknown): AiTokenUsage {
  const u = (raw ?? {}) as Record<string, unknown>;
  const input = Number(u["prompt_tokens"] ?? u["input_tokens"] ?? 0);
  const output = Number(u["completion_tokens"] ?? u["output_tokens"] ?? 0);
  return {
    inputTokens: Number.isFinite(input) ? input : 0,
    outputTokens: Number.isFinite(output) ? output : 0,
  };
}

function stripFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonLoose<T>(text: string): T {
  const cleaned = stripFence(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new AiError("PROVIDER_ERROR", { detail: "model returned non-JSON output" });
    return JSON.parse(match[0]) as T;
  }
}

function stringList(v: unknown, max = 8): string[] {
  return Array.isArray(v) ? v.filter((c): c is string => typeof c === "string").slice(0, max) : [];
}

/**
 * Pulls the inline image out of an image-modality reply.
 *
 * The gateway answers with `message.images[]`, each carrying a base64 data URL.
 * Anything else (a hosted link, a text-only refusal) is treated as no image, so
 * a caller can never end up storing a URL it did not verify.
 */
function imageFrom(message: unknown): string | null {
  const images = (message as { images?: unknown } | null)?.images;
  if (!Array.isArray(images)) return null;
  for (const entry of images) {
    const url = (entry as { image_url?: { url?: unknown } } | null)?.image_url?.url;
    if (typeof url === "string" && url.startsWith("data:image/")) return url;
  }
  return null;
}

/** Shared by generate/enhance: one image-modality call that must yield an image. */
async function imageCall(model: string, content: AiMessagePart[]): Promise<AiImageResult> {
  const raw = await rawChat({
    model,
    modalities: ["image", "text"],
    messages: [{ role: "user", content }],
  });
  const dataUrl = imageFrom(raw.message);
  if (!dataUrl) {
    // A refusal comes back as prose in place of an image. Surfacing it as a
    // provider error keeps the reason server-side.
    throw new AiError("PROVIDER_ERROR", {
      detail: `no image returned: ${String((raw.message as { content?: unknown })?.content ?? "").slice(0, 200)}`,
    });
  }
  return { dataUrl, model: raw.model, usage: raw.usage };
}

/**
 * Low-level gateway call shared by the provider methods and by tool-calling
 * agents. Applies the bounded retry policy and typed error mapping; the API key
 * never appears in a result or an error.
 */
export async function rawChat(body: {
  model: string;
  messages: any[];
  tools?: readonly any[];
  json?: boolean;
  modalities?: string[];
}): Promise<{ message: any; usage: AiTokenUsage; model: string }> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new AiError("FEATURE_DISABLED", { detail: "AI key not configured" });

  let lastError: AiError | null = null;

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          "Lovable-API-Key": key,
          "X-Lovable-AIG-SDK": "manual-worker",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: body.model,
          messages: body.messages,
          ...(body.tools ? { tools: body.tools } : {}),
          ...(body.modalities ? { modalities: body.modalities } : {}),
          ...(body.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    } catch (e) {
      lastError = toAiError(e);
      if (attempt === MAX_TRIES) throw lastError;
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = providerErrorFor(res.status, `status ${res.status}: ${text.slice(0, 300)}`);
      if (isRetryableStatus(res.status) && attempt < MAX_TRIES) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 10_000)
            : BASE_BACKOFF_MS * 2 ** (attempt - 1);
        lastError = err;
        await sleep(waitMs);
        continue;
      }
      throw err;
    }

    const data = (await res.json().catch(() => null)) as Record<string, any> | null;
    return {
      message: data?.["choices"]?.[0]?.message ?? null,
      usage: usageFrom(data?.["usage"]),
      model: body.model,
    };
  }

  throw lastError ?? new AiError("PROVIDER_ERROR");
}

export function createLovableGatewayProvider(config: AiProviderConfig): AiProvider {
  async function chat(input: {
    model: string;
    parts: AiMessagePart[];
    system: string;
    json: boolean;
  }): Promise<{ content: string; usage: AiTokenUsage; model: string }> {
    const raw = await rawChat({
      model: input.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.parts },
      ],
      json: input.json,
    });
    const content = String(raw.message?.content ?? "");
    if (!content.trim()) {
      throw new AiError("PROVIDER_ERROR", { detail: "gateway returned no content" });
    }
    return { content, usage: raw.usage, model: raw.model };
  }

  function partsFor(req: GenerateTextRequest): AiMessagePart[] {
    return req.parts ?? [{ type: "text", text: req.prompt }];
  }

  async function generateText(req: GenerateTextRequest): Promise<AiTextResult> {
    const out = await chat({
      model: req.model ?? config.textModel,
      parts: partsFor(req),
      system: req.system,
      json: false,
    });
    return { text: stripFence(out.content), model: out.model, usage: out.usage };
  }

  async function generateStructured<T>(
    req: GenerateStructuredRequest,
  ): Promise<AiStructuredResult<T>> {
    const out = await chat({
      model: req.model ?? config.textModel,
      parts: partsFor(req),
      system: req.system,
      json: true,
    });
    return { data: parseJsonLoose<T>(out.content), model: out.model, usage: out.usage };
  }

  async function analyzeImages<T>(req: AnalyzeImagesRequest): Promise<AiStructuredResult<T>> {
    const parts: AiMessagePart[] = [
      { type: "text", text: req.prompt },
      ...req.images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
    ];
    const out = await chat({
      model: req.model ?? config.visionModel,
      parts,
      system: req.system,
      json: true,
    });
    return { data: parseJsonLoose<T>(out.content), model: out.model, usage: out.usage };
  }

  async function transcribeAudio<T>(req: TranscribeAudioRequest): Promise<AiStructuredResult<T>> {
    const parts: AiMessagePart[] = [
      { type: "text", text: req.prompt },
      { type: "input_audio", input_audio: { data: req.audio, format: req.format } },
    ];
    const out = await chat({
      model: req.model ?? config.audioModel,
      parts,
      system: req.system,
      json: true,
    });
    return { data: parseJsonLoose<T>(out.content), model: out.model, usage: out.usage };
  }

  async function moderateText(req: {
    text: string;
    context?: string;
  }): Promise<AiTextModerationResult> {
    const out = await chat({
      model: config.moderationTextModel,
      parts: [
        {
          type: "text",
          text: `${req.context ? `Context: ${req.context}\n` : ""}Classify this text:\n${req.text.slice(0, 4000)}`,
        },
      ],
      system: MODERATION_SYSTEM,
      json: true,
    });
    const parsed = parseJsonLoose<{ verdict?: string; categories?: unknown; reason?: string }>(
      out.content,
    );
    const verdict: TextVerdict =
      parsed.verdict === "block" || parsed.verdict === "review" ? parsed.verdict : "allow";
    return {
      verdict,
      categories: stringList(parsed.categories),
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : null,
      model: out.model,
      usage: out.usage,
    };
  }

  async function moderateImage(req: { imageUrl: string }): Promise<AiImageModerationResult> {
    const out = await chat({
      model: config.moderationImageModel,
      parts: [
        { type: "text", text: "Classify this uploaded image." },
        { type: "image_url", image_url: { url: req.imageUrl } },
      ],
      system: IMAGE_MODERATION_SYSTEM,
      json: true,
    });
    const parsed = parseJsonLoose<{
      safe?: boolean;
      label?: string;
      categories?: unknown;
      reason?: string;
    }>(out.content);
    return {
      safe: parsed.safe !== false,
      label: typeof parsed.label === "string" ? parsed.label : "unknown",
      categories: stringList(parsed.categories),
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : null,
      model: out.model,
      usage: out.usage,
    };
  }

  async function generateImage(req: GenerateImageRequest): Promise<AiImageResult> {
    return imageCall(req.model ?? config.imageModel, [{ type: "text", text: req.prompt }]);
  }

  async function enhanceImage(req: EnhanceImageRequest): Promise<AiImageResult> {
    return imageCall(req.model ?? config.imageModel, [
      { type: "text", text: req.prompt },
      { type: "image_url", image_url: { url: req.imageUrl } },
    ]);
  }

  return {
    name: config.provider,
    generateText,
    generateStructured,
    analyzeImages,
    transcribeAudio,
    moderateText,
    moderateImage,
    generateImage,
    enhanceImage,
  };
}

export const AI_GATEWAY_URL = GATEWAY_URL;
export const AI_MAX_TRIES = MAX_TRIES;
