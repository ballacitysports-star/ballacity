/**
 * Redaction logic for CI logs and artifacts. Importing it runs nothing; the CLI is
 * ci-redact.mjs. Dependency-free, no network.
 *
 * Two layers. (1) Exact values: any environment variable whose name looks like a
 * credential, or that is a Supabase/E2E setting, is replaced wherever its value
 * appears, also in its JSON-escaped forms (up to three layers of escaping, so embedded
 * quotes, newlines, tabs and backslashes are covered). (2) Shapes: URL credentials,
 * JWTs, Supabase and Stripe-style keys, bearer tokens, values of credential-named
 * fields (with any number of backslashes before the quotes, so fields inside JSON that
 * was itself JSON-encoded are covered), cookie headers, and Supabase project hosts.
 *
 * Limits, stated plainly. Shape matching is a safety net, not a guarantee. Not
 * detectable: an opaque value with no recognizable format that is neither a known
 * environment value nor next to a credential-looking field name; a field name that is
 * itself escaped (for example a unicode escape inside the name); secrets split across
 * lines or fields; secrets that were base64-, URL- or otherwise re-encoded; and values
 * not available to the process (for example session tokens minted by Playwright global
 * setup, which are deliberately not handed to the redaction step).
 */
const NAME_LOOKS_SECRET = /KEY|TOKEN|SECRET|PASSWORD|JWT|SESSION|COOKIE|AUTH/i;
const NAME_IS_TARGET = /^(E2E_|VITE_|SUPABASE_|LOVABLE_BROWSER_)/;
const MIN_LEN = 8;
const MIN_LINE_LEN = 12;
const MAX_LINE = 300;
const ESCAPE_LAYERS = 3;

const FIELD_NAMES =
  "api[_-]?key|authorization|(?:access|refresh|id|provider|session)[_-]?token|client[_-]?secret|password|passwd|secret|token|jwt";
// A value: ordinary characters, plus unicode escapes and escaped slashes. It stops at a
// quote, a backslash that is not one of those escapes, whitespace or a delimiter, so it
// does not run into the surrounding JSON.
const FIELD_VALUE = String.raw`(?:[^\s"'\\,;}\]]|\\+u[0-9a-fA-F]{4}|\\\/)+`;

const SHAPES = [
  // user:password@ in any scheme://. Scheme and host are kept; the userinfo is not.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\/\s"'\\?#]*@/gi, "$1[REDACTED]@"],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[REDACTED:jwt]"],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[REDACTED:supabase-key]"],
  [/\b(?:pk|sk|rk)_(?:live|test)_[A-Za-z0-9]+/g, "[REDACTED:payments-key]"],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[REDACTED:bearer]"],
  // Whole cookie header value, which holds several name=value pairs.
  [/(\\*["']?(?:set-)?cookie\\*["']?\s*[:=]\s*\\*["']?)[^"'\\\r\n]+/gi, "$1[REDACTED]"],
  [
    new RegExp(
      String.raw`(\\*["']?)(${FIELD_NAMES})(\\*["']?)(\s*[:=]\s*)(\\*["']?)${FIELD_VALUE}`,
      "gi",
    ),
    "$1$2$3$4$5[REDACTED]",
  ],
  [/\b[a-z0-9]{20}\.supabase\.(?:co|in)\b/gi, "[REDACTED:host]"],
];

/** The text as it would appear inside 1..n layers of JSON string escaping. */
function escapeLayers(text) {
  const out = [];
  let cur = text;
  for (let i = 0; i < ESCAPE_LAYERS; i++) {
    cur = JSON.stringify(cur).slice(1, -1);
    out.push(cur);
  }
  return out;
}

/** Every form of a value worth searching for: raw, per line, escaped, slash-escaped. */
function variantsOf(value) {
  const bases = new Set([value]);
  for (const line of value.split(/\r\n|\n|\r/)) {
    if (line.trim().length >= MIN_LINE_LEN) bases.add(line.trim());
  }
  const all = new Set();
  for (const b of bases) {
    all.add(b);
    all.add(b.replace(/\//g, "\\/"));
    for (const e of escapeLayers(b)) all.add(e);
  }
  return [...all].filter((x) => x.length >= MIN_LEN);
}

/** @param {string} text @param {Record<string, string | undefined>} env */
export function redact(text, env = {}) {
  let out = String(text);
  const replacements = [];
  for (const [name, value] of Object.entries(env)) {
    const v = typeof value === "string" ? value.trim() : "";
    if (v.length >= MIN_LEN && (NAME_LOOKS_SECRET.test(name) || NAME_IS_TARGET.test(name))) {
      for (const variant of variantsOf(v)) replacements.push([name, variant]);
    }
  }
  // Longest first, so a value that contains another is replaced whole.
  replacements.sort((a, b) => b[1].length - a[1].length);
  for (const [name, v] of replacements) out = out.split(v).join(`[REDACTED:${name}]`);
  for (const [re, rep] of SHAPES) out = out.replace(re, rep);
  return out;
}

/** Redact, cap each line's length, and keep only the last `tail` lines. */
export function sanitizeLog(text, env = {}, tail = 80) {
  const lines = redact(text, env)
    .split("\n")
    .map((l) => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE)}…[truncated]` : l));
  return lines.slice(-tail).join("\n");
}
