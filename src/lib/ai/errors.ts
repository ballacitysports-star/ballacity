/**
 * One typed error set for every AI feature.
 *
 * Clients only ever see `code` + `userMessage`. Raw provider bodies, stack
 * traces and anything credential-shaped stay on the server: `AiError` keeps the
 * technical detail in a non-enumerable field that never lands in JSON, logs, or
 * `toString()` output.
 */

export const AI_ERROR_CODES = [
  "FEATURE_DISABLED",
  "CONSENT_REQUIRED",
  "PARENT_APPROVAL_REQUIRED",
  "QUOTA_EXCEEDED",
  "CONCURRENCY_LIMIT",
  "RATE_LIMITED",
  "INVALID_MEDIA",
  "UNSUPPORTED_FORMAT",
  "FILE_TOO_LARGE",
  "VIDEO_TOO_LONG",
  "MODERATION_BLOCKED",
  "MODERATION_UNAVAILABLE",
  "PROVIDER_ERROR",
  "TIMEOUT",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  FEATURE_DISABLED: "This AI feature is turned off right now. Try again later.",
  CONSENT_REQUIRED:
    "AI processing is turned off for your account. You can turn it on in Settings → Privacy.",
  PARENT_APPROVAL_REQUIRED:
    "A parent or guardian needs to allow AI features for this account first.",
  QUOTA_EXCEEDED: "You've used your AI allowance for now. It resets shortly.",
  CONCURRENCY_LIMIT: "You already have AI work in progress. Let it finish, then try again.",
  RATE_LIMITED: "AI is busy right now. Try again in a moment.",
  INVALID_MEDIA: "That file couldn't be read. Try a different one.",
  UNSUPPORTED_FORMAT: "That file type isn't supported.",
  FILE_TOO_LARGE: "That file is too large.",
  VIDEO_TOO_LONG: "That video is longer than we can process.",
  MODERATION_BLOCKED: "This didn't pass our safety check, so it wasn't saved.",
  MODERATION_UNAVAILABLE: "The safety check couldn't run, so this is only visible to you for now.",
  PROVIDER_ERROR: "AI couldn't finish that. Please try again.",
  TIMEOUT: "That took too long. Please try again.",
};

/** Keys whose values must never leave the server, mirroring the audit-log scrubber. */
const SENSITIVE_KEY =
  /(pass(word|wd|phrase)?|token|secret|api[-_]?key|authorization|auth[-_]?header|cookie|session|refresh|jwt|bearer|credential|private[-_]?key)/i;

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly userMessage: string;
  readonly status: number | null;
  /** Server-only detail. Non-enumerable so JSON.stringify never emits it. */
  readonly detail?: string;

  constructor(code: AiErrorCode, opts: { detail?: string; status?: number | null } = {}) {
    super(AI_ERROR_MESSAGES[code]);
    this.name = "AiError";
    this.code = code;
    this.userMessage = AI_ERROR_MESSAGES[code];
    this.status = opts.status ?? null;
    if (opts.detail) {
      Object.defineProperty(this, "detail", {
        value: redactSecrets(opts.detail),
        enumerable: false,
        writable: false,
      });
    }
  }

  /** Exactly what a client is allowed to see. */
  toClient(): { code: AiErrorCode; message: string } {
    return { code: this.code, message: this.userMessage };
  }

  toJSON() {
    return this.toClient();
  }
}

export function isAiError(e: unknown): e is AiError {
  return e instanceof AiError;
}

/** Strips anything credential-shaped out of free text before it is stored or logged. */
export function redactSecrets(input: string): string {
  return input
    .replace(/\b(sk|rk|pk|sb|lov)[-_][A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted]")
    .replace(
      /("?(?:[A-Za-z-]*(?:key|token|secret|authorization|password|credential))"?\s*[:=]\s*"?)([^",\s}]+)/gi,
      "$1[redacted]",
    );
}

/** Recursively redacts an object before it is logged or written to a job row. */
export function safeLogValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return redactSecrets(value).slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "[depth limit]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => safeLogValue(v, depth + 1));
  if (value instanceof AiError) return value.toClient();
  if (value instanceof Error) return { message: redactSecrets(value.message).slice(0, 300) };
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : safeLogValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * Maps a provider HTTP status onto the typed set. Only 429 and 5xx are worth
 * retrying; everything else is terminal.
 */
export function providerErrorFor(status: number, body?: string): AiError {
  if (status === 429) return new AiError("RATE_LIMITED", { status, detail: body });
  if (status === 408 || status === 504) return new AiError("TIMEOUT", { status, detail: body });
  return new AiError("PROVIDER_ERROR", { status, detail: body });
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Anything thrown inside the AI layer leaves as a typed error. */
export function toAiError(e: unknown, fallback: AiErrorCode = "PROVIDER_ERROR"): AiError {
  if (isAiError(e)) return e;
  const detail = e instanceof Error ? e.message : String(e);
  if (/abort|timed? ?out/i.test(detail)) return new AiError("TIMEOUT", { detail });
  return new AiError(fallback, { detail });
}
