import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM without types
import { redact, redactJsonReport, sanitizeLog } from "../../.github/ci-redact-lib.mjs";

/** Synthetic values only. */
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = `${b64({ alg: "HS256" })}.${b64({ role: "service_role", ref: "abcdefghijklmnopqrst" })}.sig123456`;
const SVC = "synthetic-service-value-0001";
const OPAQUE = "opaque-synthetic-refresh-value-77";
const enc = (s: string, layers: number) => {
  let cur = s;
  for (let i = 0; i < layers; i++) cur = JSON.stringify(cur).slice(1, -1);
  return cur;
};

describe("redact: exact values", () => {
  it("replaces values of credential-named and target variables", () => {
    const out = redact(`boom ${SVC} and ${JWT}`, {
      SUPABASE_SERVICE_ROLE_KEY: SVC,
      LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN: JWT,
      HARMLESS: "keep-this-value",
    });
    expect(out).not.toContain(SVC);
    expect(out).not.toContain(JWT);
    expect(out).toContain("[REDACTED:SUPABASE_SERVICE_ROLE_KEY]");
  });

  it("leaves ordinary text alone and ignores short values", () => {
    expect(redact("Vite ready in 300 ms on port 8080", { SOME_TOKEN: "abc" })).toBe(
      "Vite ready in 300 ms on port 8080",
    );
  });

  it("replaces the longest value first", () => {
    const out = redact("x-longervalue-1234-x", { A_KEY: "value-1234", B_KEY: "longervalue-1234" });
    expect(out).not.toContain("1234");
  });

  it("redacts multiple secrets in one log line", () => {
    const line = `a=${SVC} b=${OPAQUE} c=${JWT} d=pk_live_abc123XYZ`;
    const out = redact(line, { ONE_SECRET: SVC, TWO_TOKEN: OPAQUE });
    for (const leak of [SVC, OPAQUE, JWT, "pk_live_abc123XYZ"]) expect(out).not.toContain(leak);
  });

  // B4: the value survives neither plain nor JSON-escaped, at any depth.
  const MULTI = 'line-one-of-the-secret\nline "two" of it\r\n\ttabbed back\\slash end';
  it.each([0, 1, 2, 3])("a multiline secret does not survive %i layer(s) of JSON escaping", (n) => {
    const text = `before ${n === 0 ? MULTI : enc(MULTI, n)} after`;
    const out = redact(text, { MY_SECRET: MULTI });
    expect(out).toContain("before");
    expect(out).toContain("after");
    for (const frag of ["line-one-of-the-secret", "tabbed back", 'line "two" of it']) {
      expect(out).not.toContain(frag);
      expect(out).not.toContain(enc(frag, 1));
    }
  });

  it("does not leave the value in a JSON document that embeds it", () => {
    const doc = JSON.stringify({ error: { message: `failed with ${MULTI}` } });
    const out = redact(doc, { MY_SECRET: MULTI });
    expect(out).not.toContain("line-one-of-the-secret");
    JSON.parse(out); // still valid JSON
  });

  it("covers a slash-escaped form", () => {
    const v = "https://sandbox.example/secret/path-value";
    expect(redact(`x ${v.replace(/\//g, "\\/")} y`, { A_TOKEN: v })).not.toContain("path-value");
  });
});

describe("redact: shapes", () => {
  it("redacts representative credential formats", () => {
    const text = [
      `token ${JWT}`,
      "key sb_secret_abcDEF123_x and sb_publishable_zzz999",
      "stripe pk_live_abc123XYZ and sk_test_abc123XYZ",
      "Authorization: Bearer abcdef0123456789xyz",
      '{"access_token":"a-long-opaque-value","refresh_token": "another-one"}',
      "host abcdefghijklmnopqrst.supabase.co/rest/v1",
      "password=hunter2hunter2",
      "SUPABASE_SERVICE_ROLE_KEY=svc-value-assignment",
    ].join("\n");
    const out = redact(text, {});
    for (const leak of [
      JWT,
      "sb_secret_abcDEF123_x",
      "sb_publishable_zzz999",
      "pk_live_abc123XYZ",
      "sk_test_abc123XYZ",
      "abcdef0123456789xyz",
      "a-long-opaque-value",
      "another-one",
      "abcdefghijklmnopqrst",
      "hunter2hunter2",
    ]) {
      expect(out).not.toContain(leak);
    }
  });

  it("redacts cookie headers whole", () => {
    const out = redact("cookie: sb-ref-auth-token=aaaa1111; other=bbbb2222; third=cccc3333", {});
    for (const leak of ["aaaa1111", "bbbb2222", "cccc3333"]) expect(out).not.toContain(leak);
  });

  it("does not mangle unrelated fields", () => {
    const text = '{"token_type":"bearer","title":"sign in","count":3,"tokens_used":12}';
    expect(redact(text, {})).toBe(text);
  });
});

describe("redact: URL credentials (B1)", () => {
  it.each([
    ["https://user:password@example.com/path", "password"],
    ["http://admin:s3cr3t-pass@host.test:8080/x?y=1", "s3cr3t-pass"],
    ["postgres://dbuser:db-pass-123@db.internal:5432/app", "db-pass-123"],
    ["postgresql://u:p%40ss%3Aword%2F1@host/db", "p%40ss"],
    ["https://only-a-token-value@example.com/", "only-a-token-value"],
    ["redis://:pw-in-userinfo@cache.local:6379", "pw-in-userinfo"],
    ["https://user:p@ss@word@example.com/", "word@example"],
  ])("%s", (url, secret) => {
    const out = redact(`see ${url} for details`, {});
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED]@");
    expect(out).toContain("for details");
  });

  it("keeps scheme and host, and URLs without credentials untouched", () => {
    expect(redact("https://user:pw-123456@example.com/a", {})).toBe(
      "https://[REDACTED]@example.com/a",
    );
    const plain = "GET https://example.com/path?email=a@b.com#frag@x";
    expect(redact(plain, {})).toBe(plain);
  });

  it("handles several URLs in one string without consuming text between them", () => {
    const out = redact(
      "a https://u1:pw-one-111@h1.test/x then plain https://h2.test/y and postgres://u2:pw-two-222@h3/db end",
      {},
    );
    expect(out).toBe(
      "a https://[REDACTED]@h1.test/x then plain https://h2.test/y and postgres://[REDACTED]@h3/db end",
    );
  });

  it("does not consume surrounding JSON, escaped or not", () => {
    const doc = JSON.stringify({ a: "https://u:pw-json-333@host.test/x", b: "keep", c: [1, 2] });
    const out = redact(doc, {});
    expect(out).not.toContain("pw-json-333");
    expect(JSON.parse(out).b).toBe("keep");
    const nested = JSON.stringify({ msg: doc });
    const out2 = redact(nested, {});
    expect(out2).not.toContain("pw-json-333");
    expect(JSON.parse(JSON.parse(out2).msg).b).toBe("keep");
  });

  it("handles malformed URLs without throwing or leaking", () => {
    for (const bad of ["https://", "://@", "http://@@@", "https://user:@", "a://b@"]) {
      expect(() => redact(bad, {})).not.toThrow();
    }
    expect(redact("https://user:pw-bad-444@", {})).not.toContain("pw-bad-444");
  });
});

describe("redact: JSON-encoded secrets (B2)", () => {
  const body = {
    access_token: "opaque-token-value-123",
    refresh_token: OPAQUE,
    password: "hunter2hunter2",
    api_key: "plain-api-key-value",
    note: "keep me",
  };

  // The exact failure from the audit: a JSON body quoted inside a JSON string.
  it("the audit failure: an escaped access_token and password inside a report string", () => {
    const report = JSON.stringify({
      err: JSON.stringify({ access_token: "opaque-token-value-123", password: "hunter2hunter2" }),
    });
    const out = redact(report, {});
    expect(out).not.toContain("opaque-token-value-123");
    expect(out).not.toContain("hunter2hunter2");
    JSON.parse(out);
  });

  it.each([1, 2, 3])("redacts sensitive fields at %i layer(s) of escaping", (n) => {
    let text = JSON.stringify(body);
    for (let i = 1; i < n; i++) text = JSON.stringify(text).slice(1, -1);
    const out = redact(text, {});
    for (const v of ["opaque-token-value-123", OPAQUE, "hunter2hunter2", "plain-api-key-value"]) {
      expect(out).not.toContain(v);
    }
    expect(out).toContain("keep me");
  });

  it("keeps the document valid and the unrelated parts readable", () => {
    const report = JSON.stringify({
      suites: [{ title: "pay", error: JSON.stringify(body) }],
      n: 1,
    });
    const out = redact(report, {});
    const parsed = JSON.parse(out);
    expect(parsed.n).toBe(1);
    expect(parsed.suites[0].title).toBe("pay");
    expect(parsed.suites[0].error).toContain("keep me");
  });

  it("handles nested objects and arrays", () => {
    const nested = JSON.stringify({
      session: { user: { id: "u1" }, tokens: [{ access_token: "nested-token-aaaa" }] },
      list: [{ password: "nested-pass-bbbb" }, { ok: true }],
    });
    for (const text of [nested, JSON.stringify(nested)]) {
      const out = redact(text, {});
      expect(out).not.toContain("nested-token-aaaa");
      expect(out).not.toContain("nested-pass-bbbb");
    }
  });

  it("handles unicode escapes inside values and keeps the match from running on", () => {
    const text = '{"refresh_token":"abc\\u003ddef\\u002Bghi","after":"visible"}';
    const out = redact(text, {});
    expect(out).not.toContain("abc");
    expect(out).not.toContain("ghi");
    expect(out).toContain('"after":"visible"');
    const layered = '{\\"refresh_token\\":\\"abc\\\\u003ddef\\",\\"after\\":\\"visible\\"}';
    const out2 = redact(layered, {});
    expect(out2).not.toContain("def");
    expect(out2).toContain("visible");
  });

  it("handles very long values in linear time", () => {
    const long = "x".repeat(2_000_000);
    const text = `{"access_token":"${long}","tail":"visible"}`;
    const t = Date.now();
    const out = redact(text, {});
    expect(Date.now() - t).toBeLessThan(2000);
    expect(out).not.toContain("xxxxxxxxxx");
    expect(out).toContain('"tail":"visible"');
  });

  it("still detects JWTs, bearer credentials and key formats inside escaped strings", () => {
    const msg = JSON.stringify({
      m: JSON.stringify({ h: `Bearer abcdef0123456789xyz`, j: JWT, k: "sb_secret_zzz999_q" }),
    });
    const out = redact(msg, {});
    for (const leak of ["abcdef0123456789xyz", JWT, "sb_secret_zzz999_q"]) {
      expect(out).not.toContain(leak);
    }
  });

  it("handles session JSON stringified into a string field", () => {
    const session = JSON.stringify({
      access_token: JWT,
      refresh_token: OPAQUE,
      user: { email: "e2e@example.test" },
    });
    const out = redact(JSON.stringify({ LOVABLE_SESSION: session }), {});
    expect(out).not.toContain(JWT);
    expect(out).not.toContain(OPAQUE);
    expect(out).toContain("e2e@example.test");
  });

  it("never throws on odd input", () => {
    for (const odd of ["", "\\", '\\"', '"', "{", "\\\\\\\\", "\u0000", "token=", '"token":']) {
      expect(() => redact(odd, {})).not.toThrow();
    }
  });
});

describe("sanitizeLog", () => {
  it("keeps only the tail and caps line length", () => {
    const text =
      Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n") + `\n${"x".repeat(1000)}`;
    const out = sanitizeLog(text, {}, 10).split("\n");
    expect(out).toHaveLength(10);
    expect(out.at(-1)!.length).toBeLessThan(400);
    expect(out.at(-1)).toContain("[truncated]");
  });
});

/** The real CLI, run from a path with spaces. */
function checkout() {
  const root = join(mkdtempSync(join(tmpdir(), "redact ")), "my repo");
  mkdirSync(join(root, ".github"), { recursive: true });
  for (const f of ["ci-redact.mjs", "ci-redact-lib.mjs"])
    copyFileSync(resolve(".github", f), join(root, ".github", f));
  return root;
}
const cli = (root: string, args: string[], input = "", env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [join(root, ".github", "ci-redact.mjs"), ...args], {
    cwd: root,
    input,
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

describe("ci-redact CLI: log mode", () => {
  it("filters stdin from a spaced path and never prints the exact secret", () => {
    const r = cli(checkout(), ["--tail", "5"], `crash with ${SVC}\nand ${JWT}\n`, {
      SUPABASE_SERVICE_ROLE_KEY: SVC,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain(SVC);
    expect(r.stdout).not.toContain(JWT);
  });

  it("withholds output on a bad argument instead of echoing the input", () => {
    const r = cli(checkout(), ["--tail", "nope"], `secret ${SVC}\n`);
    expect(r.stdout).toContain("output withheld");
    expect(r.stdout).not.toContain(SVC);
    expect(r.stderr).not.toContain(SVC);
  });
});

describe("ci-redact CLI: stream mode", () => {
  it("redacts every line by exact value and by shape, from a spaced path", () => {
    const input = [
      `first ${SVC}`,
      "plain line",
      `Authorization: Bearer abcdef0123456789xyz`,
      `x ${JWT}`,
    ].join("\n");
    const r = cli(checkout(), ["--stream"], `${input}\n`, { SUPABASE_SERVICE_ROLE_KEY: SVC });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("plain line");
    for (const leak of [SVC, "abcdef0123456789xyz", JWT]) expect(r.stdout).not.toContain(leak);
    expect(r.stdout.trim().split("\n")).toHaveLength(4);
  });

  it("redacts a secret that appears in the same line as other secrets", () => {
    const r = cli(checkout(), ["--stream"], `a=${SVC} b=${OPAQUE} c=pk_live_abc123XYZ\n`, {
      ONE_SECRET: SVC,
      TWO_TOKEN: OPAQUE,
    });
    for (const leak of [SVC, OPAQUE, "pk_live_abc123XYZ"]) expect(r.stdout).not.toContain(leak);
  });

  it("handles a large stream without buffering it all", () => {
    const lines = Array.from({ length: 50_000 }, (_, i) => `line ${i} ${SVC}`).join("\n");
    const r = cli(checkout(), ["--stream"], `${lines}\n`, { A_SECRET: SVC });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain(SVC);
    expect(r.stdout.trim().split("\n")).toHaveLength(50_000);
  });

  it("refuses extra arguments with a fixed message and exit 1, printing no input", () => {
    const r = cli(checkout(), ["--stream", "--tail", "5"], `secret ${SVC}\n`);
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).not.toContain(SVC);
    expect(r.stderr).toContain("could not redact");
  });
});

describe("ci-redact CLI: closed pipes and failures", () => {
  /** Runs `script` with the redactor path and a scratch dir as $1 and $2 (no string splicing). */
  const bash = (root: string, script: string) =>
    spawnSync(
      "bash",
      ["--noprofile", "--norc", "-c", script, "_", join(root, ".github", "ci-redact.mjs"), root],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 60_000,
        env: { PATH: process.env.PATH ?? "", SUPABASE_SERVICE_ROLE_KEY: SVC },
      },
    );
  const redactor = () => 'node "$1"';

  it("a consumer that closes early gives a fixed message and exit 1, with no stack trace", () => {
    const root = checkout();
    // upstream | redactor | consumer that reads one line then exits. Report each exit status.
    const r = bash(
      root,
      `yes "line $SUPABASE_SERVICE_ROLE_KEY pk_live_abcdefghij123456" | head -n 300000 | ${redactor()} --stream 2>"$2/err.txt" | head -n 1 > "$2/out.txt"
echo "\${PIPESTATUS[2]}" > "$2/status.txt"`,
    );
    expect(r.status, r.stderr).toBe(0);
    const out = readFileSync(join(root, "out.txt"), "utf8");
    const err = readFileSync(join(root, "err.txt"), "utf8");
    expect(readFileSync(join(root, "status.txt"), "utf8").trim()).toBe("1");
    expect(out).toContain("[REDACTED:SUPABASE_SERVICE_ROLE_KEY]");
    expect(out).not.toContain(SVC);
    expect(err).toContain("ci-redact: the output was closed by its consumer; stopping.");
    for (const noise of ["EPIPE", "Unhandled", "    at ", "node:events", "Node.js v"]) {
      expect(err).not.toContain(noise);
    }
    expect(err).not.toContain(SVC);
  });

  it("the tail and file modes also fail cleanly when output cannot be delivered", () => {
    const root = checkout();
    const r = bash(
      root,
      `yes "x $SUPABASE_SERVICE_ROLE_KEY" | head -n 50000 | ${redactor()} --tail 40000 2>"$2/err.txt" | head -c 1 > /dev/null
echo "\${PIPESTATUS[2]}" > "$2/status.txt"`,
    );
    expect(r.status, r.stderr).toBe(0);
    const err = readFileSync(join(root, "err.txt"), "utf8");
    expect(["0", "1"]).toContain(readFileSync(join(root, "status.txt"), "utf8").trim());
    for (const noise of ["EPIPE", "Unhandled", "    at "]) expect(err).not.toContain(noise);
  });

  it("an upstream failure keeps its exit status through a healthy redactor (pipefail)", () => {
    const root = checkout();
    const r = bash(
      root,
      `set -eo pipefail; (echo hello; exit 7) | ${redactor()} --stream; echo "unreachable"`,
    );
    expect(r.status).toBe(7);
    expect(r.stdout).toContain("hello");
    expect(r.stdout).not.toContain("unreachable");
  });

  it("a redactor failure with a healthy upstream fails the pipeline and prints nothing from the input", () => {
    const root = checkout();
    const r = bash(
      root,
      `set -eo pipefail; (echo "secret $SUPABASE_SERVICE_ROLE_KEY"; exit 0) | ${redactor()} --stream --bogus; echo "unreachable"`,
    );
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).not.toContain(SVC);
    expect(r.stdout).not.toContain("unreachable");
  });

  it("an exception while redacting a line is a failure: nothing from the line is printed, exit 1", () => {
    const root = checkout();
    // A preload makes the regex engine throw, as a stand-in for any unexpected redaction error.
    writeFileSync(
      join(root, "break.mjs"),
      `const original = RegExp.prototype[Symbol.replace];
RegExp.prototype[Symbol.replace] = function (...args) {
  if (process.env.BREAK_REDACTION === "1") throw new Error("injected");
  return original.apply(this, args);
};`,
    );
    const r = spawnSync(
      process.execPath,
      ["--import", join(root, "break.mjs"), join(root, ".github", "ci-redact.mjs"), "--stream"],
      {
        cwd: root,
        input: `first ${SVC}\nsecond ${SVC}\n`,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", BREAK_REDACTION: "1", SUPABASE_SERVICE_ROLE_KEY: SVC },
      },
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("could not redact the output stream; output stopped.");
    expect(`${r.stdout}${r.stderr}`).not.toContain(SVC);
    expect(`${r.stdout}${r.stderr}`).not.toContain("injected");
  });
});

describe("ci-redact CLI: report mode (B5)", () => {
  const setup = () => {
    const root = checkout();
    const dir = join(root, "in dir");
    mkdirSync(dir);
    return { root, input: join(dir, "results.json"), output: join(root, "out dir", "clean.json") };
  };
  const withOutDir = (o: { output: string }) =>
    mkdirSync(join(o.output, ".."), { recursive: true });

  it("writes a separate sanitized file (paths with spaces) and leaves the input alone", () => {
    const t = setup();
    withOutDir(t);
    const raw = JSON.stringify({ err: `Bearer abcdef0123456789xyz ${JWT} ${SVC}`, ok: "keep" });
    writeFileSync(t.input, raw);
    const r = cli(t.root, ["--in", t.input, "--out", t.output], "", { SOME_SECRET: SVC });
    expect(r.status).toBe(0);
    const out = readFileSync(t.output, "utf8");
    for (const leak of [SVC, JWT, "abcdef0123456789xyz"]) expect(out).not.toContain(leak);
    expect(JSON.parse(out).ok).toBe("keep");
    expect(readFileSync(t.input, "utf8")).toBe(raw); // the original is not the upload candidate
  });

  it("fails closed on a missing input: exit 1, no output file, fixed message", () => {
    const t = setup();
    withOutDir(t);
    const r = cli(t.root, ["--in", t.input, "--out", t.output]);
    expect(r.status).toBe(1);
    expect(existsSync(t.output)).toBe(false);
    expect(r.stderr).toContain("could not be sanitized");
  });

  it("fails closed on malformed JSON, without echoing it", () => {
    const t = setup();
    withOutDir(t);
    writeFileSync(t.input, `{"broken": "${SVC}`);
    const r = cli(t.root, ["--in", t.input, "--out", t.output]);
    expect(r.status).toBe(1);
    expect(existsSync(t.output)).toBe(false);
    expect(`${r.stdout}${r.stderr}`).not.toContain(SVC);
  });

  it("removes a stale output left by an earlier run", () => {
    const t = setup();
    withOutDir(t);
    writeFileSync(t.output, "STALE-UNREDACTED");
    writeFileSync(t.input, "not json");
    expect(cli(t.root, ["--in", t.input, "--out", t.output]).status).toBe(1);
    expect(existsSync(t.output)).toBe(false);
  });

  it("refuses --in equal to --out, so it can never overwrite the original", () => {
    const t = setup();
    writeFileSync(t.input, "{}");
    expect(cli(t.root, ["--in", t.input, "--out", t.input]).status).toBe(1);
  });

  it("exits nonzero when the output cannot be written (no reliance on overwriting)", () => {
    const t = setup();
    withOutDir(t);
    writeFileSync(t.input, JSON.stringify({ a: 1 }));
    mkdirSync(t.output); // a directory where the file should go
    const r = cli(t.root, ["--in", t.input, "--out", t.output]);
    expect(r.status).toBe(1);
    if (process.getuid?.() !== 0) chmodSync(join(t.output, ".."), 0o755);
  });

  it("requires both paths", () => {
    const t = setup();
    expect(cli(t.root, ["--in", t.input]).status).toBe(1);
    expect(cli(t.root, ["--out", t.output]).status).toBe(1);
  });
});

describe("the redactor files", () => {
  it("have no entrypoint detection and import only node built-ins", () => {
    const src = readFileSync(".github/ci-redact.mjs", "utf8");
    expect(src).not.toMatch(/import\.meta\.url\s*===|process\.argv\[1\]/);
    for (const f of [".github/ci-redact.mjs", ".github/ci-redact-lib.mjs"]) {
      const imports = [...readFileSync(f, "utf8").matchAll(/^import .* from "([^"]+)";/gm)].map(
        (m) => m[1],
      );
      for (const i of imports) expect(i.startsWith("node:") || i.startsWith("./")).toBe(true);
    }
  });

  it("never prints the caught error", () => {
    const src = readFileSync(".github/ci-redact.mjs", "utf8");
    expect(src).not.toMatch(/catch\s*\((?!\))/);
  });
});

/** Every string (keys included) in a parsed JSON document. */
const stringsOf = (doc: unknown): string[] => {
  if (typeof doc === "string") return [doc];
  if (Array.isArray(doc)) return doc.flatMap(stringsOf);
  if (doc && typeof doc === "object")
    return Object.entries(doc).flatMap(([k, v]) => [k, ...stringsOf(v)]);
  return [];
};
/** The forms the redactor searches for: raw, slash-escaped, 1-3 layers of escaping, long lines. */
const formsOf = (value: string) => {
  const bases = new Set([value]);
  for (const l of value.split(/\r\n|\n|\r/)) if (l.trim().length >= 12) bases.add(l.trim());
  return [...bases].flatMap((b) => [b, b.replace(/\//g, "\\/"), enc(b, 1), enc(b, 2), enc(b, 3)]);
};
/** File mode, checked: the output parses and holds no form of any env value, raw or decoded. */
const fileRedact = (raw: string, env: Record<string, string> = {}) => {
  const out = redactJsonReport(raw, env) as string;
  const views = [out, ...stringsOf(JSON.parse(out))];
  for (const v of Object.values(env))
    for (const f of formsOf(v.trim()))
      if (f.length >= 8) for (const view of views) expect(view).not.toContain(f);
  return out;
};

describe("redactJsonReport: the #486 failure", () => {
  // Playwright 1.63 writes the PR's own diff into the report (config.metadata.gitDiff) and
  // the JSON reporter writes JSON.stringify(report, undefined, 2). Escaped, the diff line
  // is `case \"check_worker_secret\":\n`; the old file mode turned `\n` into
  // `\[REDACTED]` (an invalid escape), so the report could not be parsed and nothing was
  // uploaded after 283 passing tests.
  const gitDiff = [
    "diff --git a/src/lib/data-export.test.ts b/src/lib/data-export.test.ts",
    "+      switch (fn) {",
    '+        case "check_worker_secret":',
    "+          return { data: false, error: null };",
    '+        case "expire_stale_data_exports": {',
    '+    expect(fake.rpcs.filter((f) => f !== "check_worker_secret")).toEqual([]);',
    "",
  ].join("\n");
  const report = {
    config: { metadata: { actualWorkers: 1, ci: { prTitle: "x" }, gitDiff } },
    suites: [],
    errors: [],
    stats: { expected: 283 },
  };
  const raw = JSON.stringify(report, undefined, 2);

  it("is reproduced: the report holds the escaped line the old rule broke", () => {
    expect(raw).toContain('case \\"check_worker_secret\\":\\n');
  });

  it("gives valid JSON with nothing lost", () => {
    const out = fileRedact(raw);
    expect(out).toBe(raw);
    expect(JSON.parse(out)).toEqual(report);
  });

  it("through the CLI: exit 0 and the same report", () => {
    const root = checkout();
    const input = join(root, "results.json");
    const output = join(root, "clean.json");
    writeFileSync(input, raw);
    const r = cli(root, ["--in", input, "--out", output]);
    expect(r.status).toBe(0);
    expect(readFileSync(output, "utf8")).toBe(raw);
  });

  it("log mode no longer leaves a backslash in front of the marker", () => {
    const line = 'case \\"check_worker_secret\\":\\n          return x';
    const out = redact(line, {});
    expect(out).not.toMatch(/\\\[REDACTED/);
    expect(out).toContain("return x");
  });
});

describe("redactJsonReport: credential-named keys", () => {
  const doc = {
    token: "opaque-token-aaaa",
    secret: 1234567890123,
    jwt: null,
    password: true,
    passwd: false,
    access_token: { value: "nested-value-bbbb", n: 7, ok: null, deep: [{ x: "deep-cccc" }, 42] },
    refresh_token: ["arr-dddd", -1.5e3, null, false, ["inner-eeee"]],
    "x-api-key": "header-key-ffff",
    Authorization: "Basic synthetic-credentials",
    cookie: "sb-ref-auth-token=gggg1111; other=hhhh2222",
    "set-cookie": ["a=iiii3333"],
    worker_secret: "worker-jjjj",
    db_password: "dbpass-kkkk",
    userpassword: "userpass-llll",
    token_type: "bearer",
    tokens_used: 12,
    title: "keep me",
    list: [{ password: "in-array-mmmm" }, { ok: "keep too" }],
  };
  const leaks = [
    "opaque-token-aaaa",
    "1234567890123",
    "nested-value-bbbb",
    "deep-cccc",
    "arr-dddd",
    "-1.5e3",
    "inner-eeee",
    "header-key-ffff",
    "synthetic-credentials",
    "gggg1111",
    "hhhh2222",
    "iiii3333",
    "worker-jjjj",
    "dbpass-kkkk",
    "userpass-llll",
    "in-array-mmmm",
  ];

  it.each([0, 2])(
    "replaces string and number values at any depth, keeps structure (indent %i)",
    (indent) => {
      const out = fileRedact(JSON.stringify(doc, undefined, indent));
      for (const leak of leaks) expect(out).not.toContain(leak);
      const p = JSON.parse(out);
      expect(p.token).toBe("[REDACTED]");
      expect(p.secret).toBe("[REDACTED]");
      expect(p.jwt).toBeNull();
      expect(p.password).toBe(true);
      expect(p.passwd).toBe(false);
      expect(p.access_token).toEqual({
        value: "[REDACTED]",
        n: "[REDACTED]",
        ok: null,
        deep: [{ x: "[REDACTED]" }, "[REDACTED]"],
      });
      expect(p.refresh_token).toEqual(["[REDACTED]", "[REDACTED]", null, false, ["[REDACTED]"]]);
      expect(p.cookie).toBe("[REDACTED]");
      expect(p.token_type).toBe("bearer");
      expect(p.tokens_used).toBe(12);
      expect(p.title).toBe("keep me");
      expect(p.list).toEqual([{ password: "[REDACTED]" }, { ok: "keep too" }]);
    },
  );

  it("finds a key written with escapes, as the text rules did", () => {
    // `\u0074oken` is "token" decoded; `x\token` is "x", a tab, "oken" (the text rule matched it).
    for (const raw of [
      '{"\\u0074oken": "escaped-key-nnnn"}',
      '{"x\\token": "tab-key-oooo"}',
      '{"my_token\\\\": "backslash-key-pppp"}',
    ]) {
      const out = fileRedact(raw);
      expect(out).not.toMatch(/nnnn|oooo|pppp/);
      JSON.parse(out);
    }
  });

  it("through the CLI: exit 0, valid JSON, no value left", () => {
    const root = checkout();
    const input = join(root, "results.json");
    const output = join(root, "clean.json");
    writeFileSync(input, JSON.stringify(doc, undefined, 2));
    const r = cli(root, ["--in", input, "--out", output]);
    expect(r.status).toBe(0);
    const out = readFileSync(output, "utf8");
    for (const leak of leaks) expect(out).not.toContain(leak);
    expect(JSON.parse(out).title).toBe("keep me");
  });

  it("keeps numbers, literals, unusual keys and formatting outside credential keys exactly", () => {
    const raw =
      '{"n": 12345678901234567890, "f": 1.0, "e": 1E+2, "z": -0, "b": [true, false, null],\n "__proto__": {"k": "v"}, "dup": 1, "dup": 2}';
    expect(fileRedact(raw)).toBe(raw);
  });
});

describe("redactJsonReport: escapes next to separators and exact values", () => {
  const ESCAPES = ["\\n", "\\t", "\\r", "\\b", "\\f", '\\"', "\\\\", "\\/", "\\u0041", "\\u0022"];
  // Escapes that decode to a line break leave the value on the next line, which is not
  // treated as the field's value; every other one must not shield the value.
  const LINE_BREAKS = new Set(["\\n", "\\r"]);
  const inString = (content: string) => `{"m": "${content}"}`;

  it.each(ESCAPES)("%s right after a field separator", (e) => {
    for (const content of [
      `token:${e}value-after-escape-1`,
      `token: ${e}value-after-escape-2`,
      `password=${e}value-after-escape-3`,
      `\\"secret\\":${e}value-after-escape-4`,
      `cookie: ${e}a=value-after-escape-5; b=x`,
      `case \\"check_worker_secret\\":${e}          return { data: false };`,
    ]) {
      const out = fileRedact(inString(content));
      const value = (JSON.parse(out) as { m: string }).m;
      if (!LINE_BREAKS.has(e)) expect(value).not.toMatch(/value-after-escape/);
      expect(value).not.toMatch(/\\$/);
    }
  });

  it.each(ESCAPES)("%s right before and after an exact value", (e) => {
    const env = { E2E_SUPABASE_SERVICE_ROLE_KEY: "synthetic-exact-value-0042" };
    const v = env.E2E_SUPABASE_SERVICE_ROLE_KEY;
    for (const content of [`${e}${v}${e}`, `x${e}${v}`, `${v}${e}y`, `${e}${e}${v}${e}${e}`]) {
      const out = fileRedact(inString(content), env);
      expect(out).toContain("[REDACTED:E2E_SUPABASE_SERVICE_ROLE_KEY]");
    }
  });

  it.each(["n", "t", "r", "b", "f", "u"])(
    "an exact value starting with %s right after a backslash is removed whole, not split",
    (first) => {
      // "\n" + "ightly-..." contains "nightly-..." as written, from inside the escape.
      const tail = first === "u" ? "0041ightly-synthetic-0042" : "ightly-synthetic-0042";
      const env = { SOME_TOKEN: `${first}${tail}` };
      const raw = inString(`x\\${first}${tail} y`);
      expect(raw).toContain(env.SOME_TOKEN);
      const out = fileRedact(raw, env);
      expect(out).not.toContain("ightly-synthetic-0042");
    },
  );

  it("an exact value ending in a backslash, cut through an escape, is removed", () => {
    const env = { SOME_TOKEN: "synthetic-trailing-0042\\" };
    for (const content of [
      "synthetic-trailing-0042\\n after",
      'synthetic-trailing-0042\\" after',
    ]) {
      const out = fileRedact(inString(content), env);
      expect(out).not.toContain("synthetic-trailing-0042");
      expect((JSON.parse(out) as { m: string }).m).toContain("after");
    }
  });

  it("patterns never start inside an escape (\\r before rk_, \\b before earer, \\n before a host)", () => {
    for (const content of [
      "x\\rk_live_abcdef123 y",
      "x\\bearer abcdefghijkl y",
      "x\\nabcdefghijklmnopqrs.supabase.co y",
      "x\\u00e9abcdefghijklmno.supabase.co y",
    ]) {
      const out = fileRedact(inString(content));
      JSON.parse(out);
    }
  });

  it("still catches what the text rules caught through escapes", () => {
    // \u0020 inside a value and a scheme ending in a unicode escape: the text rules saw these.
    const out = fileRedact(
      inString("token: abc\\u0020def-parity-1 and \\u00e9://user:pw-parity-2@host.test/x"),
    );
    expect(out).not.toMatch(/parity-1|pw-parity-2/);
  });

  it("finds keys a word boundary misses after an escape, once the string is decoded", () => {
    const raw = JSON.stringify({
      m: `Error\n${JWT}\n\tsb_secret_after_tab_123\nBearer after-newline-1234567`,
    });
    const out = fileRedact(raw);
    for (const leak of [JWT, "sb_secret_after_tab_123", "after-newline-1234567"])
      expect(out).not.toContain(leak);
  });

  it("does not redact a marker twice", () => {
    const out = fileRedact(
      JSON.stringify({ m: 'const SECRET = "worker-secret-987"; headers: { authorization: x' }),
    );
    expect(out).toContain('SECRET = \\"[REDACTED]\\";');
    expect(out).not.toContain("[REDACTED]]");
  });
});

describe("redactJsonReport: multi-layer escaped JSON inside strings", () => {
  const body = {
    access_token: "layered-token-value-1",
    refresh_token: OPAQUE,
    password: "layered-password-2",
    api_key: "layered-api-key-3",
    cookie: "sb-a=layered-cookie-4",
    note: "keep me",
  };
  it.each([1, 2, 3, 4])("at %i layer(s)", (n) => {
    let inner = JSON.stringify(body);
    for (let i = 1; i < n; i++) inner = JSON.stringify(inner);
    const raw = JSON.stringify({ suites: [{ error: { message: `failed: ${inner}` } }], n: 1 });
    const out = fileRedact(raw);
    for (const v of Object.values(body).filter((x) => x !== "keep me"))
      expect(out).not.toContain(v.replace(/^sb-a=/, ""));
    expect(out).toContain("keep me");
    expect(JSON.parse(out).n).toBe(1);
  });
});

describe("redactJsonReport: fails closed", () => {
  it("on an exact value outside a string (a number)", () => {
    const raw = JSON.stringify({ duration: 1234567890123 });
    expect(() => redactJsonReport(raw, { E2E_RUN_ID: "1234567890123" })).toThrow();
  });

  it("on an exact value that spans JSON structure, even when the strings in it change", () => {
    const value = '{"a":"opaque-synthetic-77","b":"token: zzz12345"}';
    const raw = `{"session":${value}}`;
    expect(() => redactJsonReport(raw, { SOME_TOKEN: value })).toThrow();
  });

  it("on invalid input", () => {
    for (const bad of ["", "{", '{"a": "\\x"}', "[1,]", "\uFEFF{}"])
      expect(() => redactJsonReport(bad, {})).toThrow();
  });

  it("through the CLI: exit 1, no output file, one fixed line without the value", () => {
    const root = checkout();
    const input = join(root, "results.json");
    const output = join(root, "clean.json");
    writeFileSync(input, JSON.stringify({ duration: 1234567890123 }));
    const r = cli(root, ["--in", input, "--out", output], "", { E2E_RUN_ID: "1234567890123" });
    expect(r.status).toBe(1);
    expect(existsSync(output)).toBe(false);
    expect(r.stderr.trim()).toBe(
      "ci-redact: the report could not be sanitized; nothing will be uploaded.",
    );
    expect(`${r.stdout}${r.stderr}`).not.toContain("1234567890123");
  });
});

describe("redactJsonReport: fuzz (seeded)", () => {
  // Random reports mixing credential-like names, separators, escapes and env values. Every
  // output must parse and hold no form of any env value; credential-key values must go.
  let seed = 486;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const word = (n = 12) =>
    Array.from({ length: n }, () => pick([..."abcdefghijkmnpqrstuvwxyzABCDEFGH23456789"])).join("");
  const NAMES = ["token", "access_token", "password", "secret", "worker_secret", "x-api-key"];
  const OTHER = ["title", "token_type", "tokens_used", "message", "note"];
  const SEPS = [":", "=", ": ", " = ", ":\n", ":\t", ":\\n", "=\\t", ": \\u0020"];
  const ESC = [
    "",
    "\\n",
    "\\t",
    "\\r",
    "\\b",
    "\\f",
    '\\"',
    "\\\\",
    "\\/",
    "\\u0041",
    "\\",
    "\n",
    "\t",
    '"',
  ];
  const QUOTES = ["", '"', '\\"', "'", '\\\\\\"'];

  it("1000 reports: always valid JSON, never an env value, never a credential-key value", () => {
    for (let i = 0; i < 1000; i++) {
      const env: Record<string, string> = {};
      const values = [word(), `${pick(["n", "t", "r", "b", "f", "u"])}${word()}`, `${word()}\\`];
      env.E2E_SUPABASE_SERVICE_ROLE_KEY = pick(values);
      if (rnd() < 0.5) env.SOME_TOKEN = `${word()}${pick(["/", '"', "\n", "\t", "\\"])}${word()}`;
      const secrets: string[] = [];
      const frag = () => {
        const v = pick([word(), ...Object.values(env), enc(pick(Object.values(env)), 1), JWT]);
        return pick([
          `${pick(QUOTES)}${pick([...NAMES, ...OTHER])}${pick(QUOTES)}${pick(SEPS)}${pick(QUOTES)}${pick(ESC)}${v}`,
          `${pick(ESC)}${v}${pick(ESC)}`,
          enc(JSON.stringify({ [pick(NAMES)]: v, note: word() }), Math.floor(rnd() * 3)),
        ]);
      };
      const text = () => Array.from({ length: 1 + Math.floor(rnd() * 4) }, frag).join(pick(ESC));
      const secretValue = () => {
        const s = `cred-${word()}`;
        secrets.push(s);
        return pick<unknown>([s, { v: s, n: 5, z: null }, [s, true], s]);
      };
      const obj: Record<string, unknown> = { message: text(), [pick(OTHER)]: text() };
      for (let k = 0; k < 3; k++) obj[pick(NAMES)] = secretValue();
      obj.nested = JSON.stringify({ [pick(NAMES)]: text(), m: text() });
      const raw = JSON.stringify({ suites: [obj], stats: { n: i } }, undefined, pick([0, 2]));
      const out = fileRedact(raw, env);
      for (const s of secrets) expect(out).not.toContain(s);
      expect(JSON.parse(out).stats.n).toBe(i);
    }
  });
});

describe("redactJsonReport: time", () => {
  it("is linear on long values and long backslash runs", () => {
    const t = Date.now();
    fileRedact(JSON.stringify({ a: "x".repeat(2_000_000), access_token: "y".repeat(2_000_000) }));
    // Sized so that a quadratic rule takes well over the limit (seconds, not hours).
    fileRedact(JSON.stringify({ m: `token: ${"\\".repeat(100_000)},` }));
    fileRedact(JSON.stringify({ m: `${"\\".repeat(40_000)}x` }));
    redact(`token: ${"\\".repeat(100_000)},`, {});
    redact(`${"\\".repeat(40_000)}x`, {});
    expect(Date.now() - t).toBeLessThan(4000);
  });
});

describe("redact (logs): a value that starts with an escape", () => {
  it.each([
    ["password=\\hunter2hunter2", "hunter2hunter2"],
    ['"secret":\\nnext-line-value', "next-line-value"],
    ["token: \\u0041bcdef-unicode", "bcdef-unicode"],
    ["cookie: \\nsb-a=cookie-value-1; b=2", "cookie-value-1"],
    ['set-cookie: \\"sb-a=cookie-value-2', "cookie-value-2"],
  ])("%s is redacted with the escape, leaving no dangling backslash", (text, secret) => {
    const out = redact(text, {});
    expect(out).not.toContain(secret);
    expect(out).not.toMatch(/(^|[^\\])(\\\\)*\\\[REDACTED\]/);
  });

  it("still catches the same credential field names", () => {
    for (const name of ["worker_secret", "db_password", "userpassword", "x-api-key", "MY_TOKEN"]) {
      expect(redact(`${name}=field-value-zzzz`, {})).not.toContain("field-value-zzzz");
      expect(redact(`{"${name}":"field-value-yyyy"}`, {})).not.toContain("field-value-yyyy");
    }
  });
});
