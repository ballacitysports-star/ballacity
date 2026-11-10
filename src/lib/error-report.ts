/**
 * P0-8: error reports saved to our own table (owner decision 2026-11-08), with no personal data.
 *
 * Everything here is pure, so client and server use the same rules:
 *   * the route is a path only (no query string or hash), with ids masked;
 *   * the message is scrubbed of emails, tokens, ids, long numbers and URLs' query strings, and capped;
 *   * a short fingerprint groups the same error together without storing a stack.
 * No user id, IP or full URL is ever part of a report: only whether the person was signed in.
 */

export type ErrorSource = "client" | "server";
export type ErrorKind = "boundary" | "window" | "rejection" | "ssr" | "server_fn";

export type ErrorReport = {
  source: ErrorSource;
  kind: ErrorKind;
  message: string;
  route: string | null;
  fingerprint: string;
  release: string | null;
  signedIn: boolean;
};

export const MESSAGE_MAX = 500;
export const ROUTE_MAX = 200;

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const BEARER = /\b(bearer|token|key|apikey|secret|password)(\s*[:=]\s*|\s+)\S+/gi;
const LONG_HEX = /\b[0-9a-f]{24,}\b/gi;
const LONG_NUMBER = /\b\d{6,}\b/g;
const QUERY = /(https?:\/\/[^\s?#]+)[?#][^\s]*/gi;
/** A path segment that is an id: a UUID, a number, or a long hex string. Not global, so .test is stateless. */
const ID_SEGMENT =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-9a-f]{16,})$/i;

/** Removes anything that could identify a person or a secret from an error message. */
export function scrubMessage(raw: string): string {
  const text = String(raw ?? "")
    .replace(QUERY, "$1")
    .replace(JWT, "[token]")
    .replace(BEARER, "$1 [redacted]")
    .replace(EMAIL, "[email]")
    .replace(UUID, "[id]")
    .replace(LONG_HEX, "[hex]")
    .replace(LONG_NUMBER, "[n]")
    .replace(/\s+/g, " ")
    .trim();
  const capped = text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX - 1)}…` : text;
  return capped || "Unknown error";
}

/** A path only: no origin, query string or hash, with ids and numbers masked. */
export function scrubRoute(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let path = String(raw);
  try {
    path = new URL(path, "https://x.invalid").pathname;
  } catch {
    path = path.split(/[?#]/)[0];
  }
  const masked = path
    .split("/")
    .map((seg) => (ID_SEGMENT.test(seg) || /@/.test(seg) ? ":id" : seg))
    .join("/");
  return masked.slice(0, ROUTE_MAX) || "/";
}

/** A short stable hash (FNV-1a, base 36) of the scrubbed message and route, to group repeats. */
export function fingerprintOf(message: string, route: string | null): string {
  const key = `${message.replace(/\d+/g, "#")}|${route ?? ""}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** The message of anything thrown, without the stack. */
export function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error)?.slice(0, MESSAGE_MAX) ?? "Unknown error";
  } catch {
    return "Unknown error";
  }
}

export function buildErrorReport(input: {
  source: ErrorSource;
  kind: ErrorKind;
  error: unknown;
  route?: string | null;
  release?: string | null;
  signedIn?: boolean;
}): ErrorReport {
  const message = scrubMessage(errorMessageOf(input.error));
  const route = scrubRoute(input.route ?? null);
  return {
    source: input.source,
    kind: input.kind,
    message,
    route,
    fingerprint: fingerprintOf(message, route),
    release: input.release ? String(input.release).slice(0, 64) : null,
    signedIn: input.signedIn === true,
  };
}

/** Errors that are not the app's fault and would only add noise. */
export function isIgnorableError(error: unknown): boolean {
  const msg = errorMessageOf(error);
  return (
    /AbortError|The user aborted a request|ResizeObserver loop/i.test(msg) ||
    /^Error: (Script error\.?)$/i.test(msg) ||
    msg === "Script error."
  );
}

export type ErrorRow = {
  fingerprint: string;
  message: string;
  route: string | null;
  source: string;
  kind: string;
  created_at: string;
  signed_in: boolean;
};

export type ErrorGroup = {
  fingerprint: string;
  message: string;
  route: string | null;
  count: number;
  signedInCount: number;
  sources: string[];
  kinds: string[];
  lastAt: string;
  firstAt: string;
};

/** Groups rows by fingerprint, most frequent first (ties: most recent first). */
export function groupErrorRows(rows: ErrorRow[]): ErrorGroup[] {
  const by = new Map<string, ErrorGroup>();
  for (const r of rows) {
    const g = by.get(r.fingerprint);
    if (!g) {
      by.set(r.fingerprint, {
        fingerprint: r.fingerprint,
        message: r.message,
        route: r.route,
        count: 1,
        signedInCount: r.signed_in ? 1 : 0,
        sources: [r.source],
        kinds: [r.kind],
        lastAt: r.created_at,
        firstAt: r.created_at,
      });
      continue;
    }
    g.count += 1;
    if (r.signed_in) g.signedInCount += 1;
    if (!g.sources.includes(r.source)) g.sources.push(r.source);
    if (!g.kinds.includes(r.kind)) g.kinds.push(r.kind);
    if (r.created_at > g.lastAt) g.lastAt = r.created_at;
    if (r.created_at < g.firstAt) g.firstAt = r.created_at;
  }
  return [...by.values()].sort((a, b) =>
    b.count !== a.count ? b.count - a.count : a.lastAt < b.lastAt ? 1 : -1,
  );
}
