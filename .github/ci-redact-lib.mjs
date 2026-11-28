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
 * Logs (`redact`, `makeRedactor`, `sanitizeLog`) are redacted as plain text.
 *
 * A JSON report (`redactJsonReport`) is redacted string by string, so the result is
 * always valid JSON and no escape sequence is ever cut in half. Each string is redacted
 * as it is written in the file (what a text redactor sees) and again decoded (so a JWT
 * after a newline or a unicode-escaped field name is found too); a changed string is
 * written back with JSON.stringify. A credential-named key's value is replaced whole:
 * every string and number in it, at any depth, becomes "[REDACTED]" (null and booleans
 * are kept). The report fails, and nothing may be uploaded, if an exact value occurs
 * anywhere but inside a single string, or is still in the output.
 *
 * Limits, stated plainly. Shape matching is a safety net, not a guarantee. Not
 * detectable: an opaque value with no recognizable format that is neither a known
 * environment value nor next to a credential-looking field name; in logs, a field name
 * that is itself escaped (for example a unicode escape inside the name); secrets split
 * across lines or fields; secrets that were base64-, URL- or otherwise re-encoded; and
 * values not available to the process (for example session tokens minted by Playwright
 * global setup, which are deliberately not handed to the redaction step).
 */
const NAME_LOOKS_SECRET = /KEY|TOKEN|SECRET|PASSWORD|JWT|SESSION|COOKIE|AUTH/i;
const NAME_IS_TARGET = /^(E2E_|VITE_|SUPABASE_|LOVABLE_BROWSER_)/;
const MIN_LEN = 8;
const MIN_LINE_LEN = 12;
const MAX_LINE = 300;
const ESCAPE_LAYERS = 3;

const FIELD_NAMES =
  "api[_-]?key|service[_-]?role[_-]?key|secret[_-]?key|authorization|(?:access|refresh|id|provider|session)[_-]?token|client[_-]?secret|password|passwd|secret|token|jwt";
// A value: ordinary characters, plus unicode escapes and escaped slashes. It stops at a
// quote, a backslash that is not one of those escapes, whitespace or a delimiter, so it
// does not run into the surrounding JSON.
const VALUE_CHAR = String.raw`[^\s"'\\,;}\]]`;
const VALUE_PART = String.raw`${VALUE_CHAR}|\\+u[0-9a-fA-F]{4}|\\\/`;
const FIELD_VALUE = String.raw`(?:${VALUE_PART})+`;
const COOKIE_CHAR = String.raw`[^"'\\\r\n]`;
// What may sit between a separator and a value: backslashes that end in a quote, or whole
// pairs of backslashes (escaped backslashes). Never a lone backslash, which would start an
// escape such as \n: replacing what follows it would leave the backslash behind.
// The pairs are taken all at once (a lookahead and a back-reference), because taking
// fewer can never let a value match, and retrying each count is quadratic on long runs.
const VALUE_QUOTE = String.raw`\\*["']`;
const BACKSLASH_PAIRS = String.raw`(?=(?<pairs>(?:\\\\)*))\k<pairs>`;
// The position follows an odd run of backslashes, so it is inside an escape sequence.
const AFTER_ODD_BACKSLASHES = String.raw`(?:^|[^\\])\\(?:\\\\)*`;

/**
 * The shape rules. Logs: a value that starts with an escape (`token:\nabc`) is replaced
 * together with that escape, so no backslash is left dangling and everything the rules
 * caught before is still caught. JSON strings (`json`): no replacement starts right
 * after a lone backslash (inside an escape such as \n or \r), and a separator is
 * followed by spaces or tabs only, never a line break. A string as written in a JSON
 * file has no raw line breaks, so this drops only replacements that used to leave an
 * invalid escape behind. `decoded`: a value that is already a marker is left alone, so the
 * second pass over a string does not turn [REDACTED] into [REDACTED]].
 */
function shapes(json, decoded = false) {
  const space = json ? String.raw`[^\S\r\n]` : String.raw`\s`;
  const start = json ? String.raw`\b(?<!${AFTER_ODD_BACKSLASHES})` : String.raw`\b`;
  // In the decoded pass, a separator followed by a marker is not a match at all (so the
  // match cannot fall back to taking the space before the marker as the value).
  const fresh = decoded ? String.raw`(?!${space}*\\*["']?\[REDACTED[\]:])` : "";
  const sep = String.raw`${space}*[:=]${fresh}${space}*`;
  const field = String.raw`(?<!\\)(\\*["']?)(${FIELD_NAMES})(\\*["']?)(${sep})`;
  const cookie = String.raw`(?<!\\)(\\*["']?(?:set-)?cookie\\*["']?${sep})`;
  return [
    // user:password@ in any scheme://. Scheme and host are kept; the userinfo is not.
    [/\b([a-z][a-z0-9+.-]*:\/\/)[^\/\s"'\\?#]*@/gi, "$1[REDACTED]@"],
    [
      new RegExp(String.raw`${start}eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*`, "g"),
      "[REDACTED:jwt]",
    ],
    [
      new RegExp(String.raw`${start}sb_(?:secret|publishable)_[A-Za-z0-9_-]+`, "g"),
      "[REDACTED:supabase-key]",
    ],
    [
      new RegExp(String.raw`${start}(?:pk|sk|rk)_(?:live|test)_[A-Za-z0-9]+`, "g"),
      "[REDACTED:payments-key]",
    ],
    [
      new RegExp(String.raw`${start}(?:Bearer|Basic)${space}+[A-Za-z0-9._~+/=-]{8,}`, "gi"),
      "[REDACTED:bearer]",
    ],
    // Whole cookie header value, which holds several name=value pairs.
    json
      ? [
          // The value does not start with a space: the old rule only did that by giving back
          // the separator's spaces when the value proper could not start, which removed
          // nothing, and here it would mark the field as done and hide the real value.
          new RegExp(
            String.raw`${cookie}(${VALUE_QUOTE}|${BACKSLASH_PAIRS})(?!\s)${COOKIE_CHAR}+`,
            "gi",
          ),
          "$1$2[REDACTED]",
        ]
      : [
          new RegExp(
            String.raw`${cookie}(?:(${VALUE_QUOTE})${COOKIE_CHAR}+|(${BACKSLASH_PAIRS})(?:\\${COOKIE_CHAR}${COOKIE_CHAR}*|${COOKIE_CHAR}+))`,
            "gi",
          ),
          (_m, head, quote, pairs) => `${head}${quote ?? pairs}[REDACTED]`,
        ],
    json
      ? [
          new RegExp(String.raw`${field}(${VALUE_QUOTE}|${BACKSLASH_PAIRS})${FIELD_VALUE}`, "gi"),
          "$1$2$3$4$5[REDACTED]",
        ]
      : [
          new RegExp(
            String.raw`${field}(?:(${VALUE_QUOTE})${FIELD_VALUE}|(${BACKSLASH_PAIRS})(?:\\${VALUE_CHAR}|${VALUE_PART})(?:${VALUE_PART})*)`,
            "gi",
          ),
          (_m, a, b, c, d, quote, pairs) => `${a}${b}${c}${d}${quote ?? pairs}[REDACTED]`,
        ],
    [new RegExp(String.raw`${start}[a-z0-9]{20}\.supabase\.(?:co|in)\b`, "gi"), "[REDACTED:host]"],
  ];
}
const LOG_SHAPES = shapes(false);
const ENCODED_SHAPES = shapes(true);
const DECODED_SHAPES = shapes(true, true);

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

/** [name, variant] for every redactable environment value, longest first. */
function exactValues(env) {
  const replacements = [];
  for (const [name, value] of Object.entries(env)) {
    const v = typeof value === "string" ? value.trim() : "";
    if (v.length >= MIN_LEN && (NAME_LOOKS_SECRET.test(name) || NAME_IS_TARGET.test(name))) {
      for (const variant of variantsOf(v)) replacements.push([name, variant]);
    }
  }
  // Longest first, so a value that contains another is replaced whole.
  return replacements.sort((a, b) => b[1].length - a[1].length);
}

/**
 * Build a redactor for one environment. The exact-value replacements are computed once,
 * so a long stream can be redacted line by line cheaply.
 * @param {Record<string, string | undefined>} env
 * @returns {(text: string) => string}
 */
export function makeRedactor(env = {}) {
  const replacements = exactValues(env);
  return (text) => {
    let out = String(text);
    for (const [name, v] of replacements) out = out.split(v).join(`[REDACTED:${name}]`);
    for (const [re, rep] of LOG_SHAPES) out = out.replace(re, rep);
    return out;
  };
}

/** @param {string} text @param {Record<string, string | undefined>} env */
export function redact(text, env = {}) {
  return makeRedactor(env)(text);
}

/** Redact, cap each line's length, and keep only the last `tail` lines. */
export function sanitizeLog(text, env = {}, tail = 80) {
  const lines = redact(text, env)
    .split("\n")
    .map((l) => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE)}…[truncated]` : l));
  return lines.slice(-tail).join("\n");
}

const decode = (content) => JSON.parse(`"${content}"`);
const isContent = (content) => {
  try {
    decode(content);
    return true;
  } catch {
    return false;
  }
};
const encodedMarker = (name) => JSON.stringify(`[REDACTED:${name}]`).slice(1, -1);

/**
 * Exact values in a string as written in the file. Replaced like the text redactor does
 * when that leaves the string valid. Otherwise a value started or ended inside an escape
 * sequence (a value "nightly..." after the \ of "\n"), and every occurrence is widened to
 * whole escape sequences before it is replaced.
 */
function replaceEncoded(content, replacements) {
  let out = content;
  for (const [name, v] of replacements) {
    if (out.includes(v)) out = out.split(v).join(encodedMarker(name));
  }
  if (out === content || isContent(out)) return out;
  const boundary = new Uint8Array(content.length + 1);
  for (let i = 0; i < content.length;) {
    boundary[i] = 1;
    i += content[i] !== "\\" ? 1 : content[i + 1] === "u" ? 6 : 2;
  }
  boundary[content.length] = 1;
  const spans = [];
  for (const [name, v] of replacements) {
    for (let i = content.indexOf(v); i !== -1; i = content.indexOf(v, i + 1)) {
      let a = i;
      let b = i + v.length;
      while (!boundary[a]) a--;
      while (!boundary[b]) b++;
      spans.push([a, b, name]);
    }
  }
  spans.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  let result = "";
  let at = 0;
  for (const [a, b, name] of spans) {
    if (b <= at) continue;
    if (a >= at) result += `${content.slice(at, a)}${encodedMarker(name)}`;
    at = b;
  }
  return result + content.slice(at);
}

/** One JSON string token's content (between the quotes), redacted; returns the token. */
function redactStringToken(content, replacements) {
  let encoded = replaceEncoded(content, replacements);
  for (const [re, rep] of ENCODED_SHAPES) encoded = encoded.replace(re, rep);
  const decoded = decode(encoded);
  let out = decoded;
  for (const [name, v] of replacements) {
    if (out.includes(v)) out = out.split(v).join(`[REDACTED:${name}]`);
  }
  for (const [re, rep] of DECODED_SHAPES) out = out.replace(re, rep);
  return encoded === content && out === decoded ? `"${content}"` : JSON.stringify(out);
}

// A key whose value is a credential: it ends in a field name or "cookie", optionally
// followed by escaped backslashes. Tested as written and decoded.
const CREDENTIAL_KEY_ENCODED = new RegExp(String.raw`(?:${FIELD_NAMES}|cookie)(?:\\\\)*$`, "i");
const CREDENTIAL_KEY_DECODED = new RegExp(String.raw`(?:${FIELD_NAMES}|cookie)\\*$`, "i");
const isCredentialKey = (content) =>
  CREDENTIAL_KEY_ENCODED.test(content) || CREDENTIAL_KEY_DECODED.test(decode(content));

const countOf = (text, needle) => {
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) n++;
  return n;
};

/**
 * Redact a JSON document (a Playwright report) token by token. Whitespace, punctuation,
 * numbers, literals and unchanged strings are copied as they are. Throws, and the caller
 * must then publish nothing, if the input is not valid JSON, if an exact value occurs
 * outside a single string (in a number, or across tokens), or if the output is not valid
 * JSON or still contains an exact value.
 * @param {string} raw
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function redactJsonReport(raw, env = {}) {
  const text = String(raw);
  JSON.parse(text);
  const replacements = exactValues(env);
  const out = [];
  // The input with everything but string contents blanked, for the exact-value check.
  const inStrings = [];
  const stack = [];
  let expectKey = false;
  let keySecret = false;
  const valueIsSecret = () => {
    const top = stack.at(-1);
    return top ? (top.object ? keySecret : top.secret) : false;
  };
  const literal = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      let j = i + 1;
      while (text[j] === " " || text[j] === "\t" || text[j] === "\n" || text[j] === "\r") j++;
      out.push(text.slice(i, j));
      inStrings.push("\0".repeat(j - i));
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') {
        if (j >= text.length) throw new Error("unterminated string");
        j += text[j] === "\\" ? 2 : 1;
      }
      const content = text.slice(i + 1, j);
      const top = stack.at(-1);
      if (top?.object && expectKey) {
        keySecret = top.secret || isCredentialKey(content);
        expectKey = false;
        out.push(redactStringToken(content, replacements));
      } else {
        out.push(valueIsSecret() ? '"[REDACTED]"' : redactStringToken(content, replacements));
      }
      inStrings.push(`\0${content}\0`);
      i = j + 1;
    } else if (c === "{" || c === "[") {
      stack.push({ object: c === "{", secret: valueIsSecret() });
      expectKey = c === "{";
      out.push(c);
      inStrings.push("\0");
      i++;
    } else if (c === "}" || c === "]" || c === ":" || c === ",") {
      if (c === "}" || c === "]") stack.pop();
      expectKey = c === "," && stack.at(-1)?.object === true;
      out.push(c);
      inStrings.push("\0");
      i++;
    } else {
      literal.lastIndex = i;
      const m = literal.exec(text);
      if (!m) throw new Error("unexpected token");
      const isNumber = m[0] !== "true" && m[0] !== "false" && m[0] !== "null";
      out.push(isNumber && valueIsSecret() ? '"[REDACTED]"' : m[0]);
      inStrings.push("\0".repeat(m[0].length));
      i += m[0].length;
    }
  }
  const strings = inStrings.join("");
  for (const [, v] of replacements) {
    if (countOf(text, v) !== countOf(strings, v)) throw new Error("value outside a string");
  }
  const clean = out.join("");
  JSON.parse(clean);
  for (const [, v] of replacements) {
    if (clean.includes(v)) throw new Error("value survived");
  }
  return clean;
}
