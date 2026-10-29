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
import { redact, sanitizeLog } from "../../.github/ci-redact-lib.mjs";

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
