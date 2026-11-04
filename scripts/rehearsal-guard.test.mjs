// Self-tests for scripts/rehearsal-guard.mjs (node:test; run with `bun run rehearsal:guard:test`).
// No network, no database: the guard connects to nothing, and neither do these tests.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  ALLOW_LIST,
  PRODUCTION_IDENTIFIERS,
  ROOT,
  checkSandbox,
  main,
} from "./rehearsal-guard.mjs";

const TOOL = join(ROOT, "scripts/rehearsal-guard.mjs");
const SANDBOX = "abcdefghijklmnopqrst";
const OTHER = "zyxwvutsrqponmlkjihg";
const entry = (over = {}) => ({
  project_ref: SANDBOX,
  verified_by: "Owner Name",
  verified_on: "2026-11-10",
  owner_signoff: "docs/release/r4-staging-rehearsal.md sign-off row 1, signed 2026-11-10",
  ...over,
});
const jwt = (payload) =>
  `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A scratch "checkout" holding only the files the guard reads. */
function fakeRoot(list) {
  const dir = mkdtempSync(join(tmpdir(), "rehearsal-guard-"));
  dirs.push(dir);
  mkdirSync(join(dir, "docs/release"), { recursive: true });
  if (list !== undefined) writeFileSync(join(dir, ALLOW_LIST), JSON.stringify(list));
  return dir;
}
const run = (env, root) => {
  const out = [];
  const code = main({ env, root, log: (s) => out.push(s), error: (s) => out.push(s) });
  return { code, text: out.join("\n") };
};

test("the shipped allow-list is an empty list, so nothing is verified now", () => {
  assert.deepEqual(JSON.parse(readFileSync(join(ROOT, ALLOW_LIST), "utf8")), []);
});

test("CLI with the shipped (empty) allow-list refuses even a well-formed ref", () => {
  const r = spawnSync(process.execPath, [TOOL], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, SANDBOX_PROJECT_REF: SANDBOX },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /REFUSED/);
  assert.match(r.stderr, /verified-sandboxes\.json is empty/);
});

test("CLI refuses when SANDBOX_PROJECT_REF is unset", () => {
  const r = spawnSync(process.execPath, [TOOL], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SANDBOX_PROJECT_REF is not set/);
});

test("refuses every production identifier, whatever the allow-list says", () => {
  for (const id of PRODUCTION_IDENTIFIERS) {
    const res = checkSandbox({ ref: id, allowList: [entry({ project_ref: id })] });
    assert.equal(res.ok, false);
    assert.ok(
      res.failures.includes("SANDBOX_PROJECT_REF is a production identifier"),
      res.failures.join("\n"),
    );
    assert.ok(
      res.failures.some((f) => /names a production identifier; the list is refused/.test(f)),
    );
  }
  const upper = checkSandbox({ ref: "CPQIHHCQEIVBGXQBZATV", allowList: [entry()] });
  assert.ok(upper.failures.includes("SANDBOX_PROJECT_REF is a production identifier"));
});

test("refuses a ref that is not on the allow-list, or malformed", () => {
  const res = checkSandbox({ ref: OTHER, allowList: [entry()] });
  assert.equal(res.ok, false);
  assert.ok(res.failures.includes("SANDBOX_PROJECT_REF is not in the owner-verified allow-list"));
  const bad = checkSandbox({ ref: "https://abc.supabase.co", allowList: [entry()] });
  assert.ok(bad.failures.some((f) => /not a Supabase project ref/.test(f)));
});

test("refuses incomplete, revoked or duplicated allow-list entries", () => {
  for (const f of ["verified_by", "verified_on", "owner_signoff"]) {
    const res = checkSandbox({ ref: SANDBOX, allowList: [entry({ [f]: "" })] });
    assert.ok(res.failures.includes(`allow-list entry for the sandbox has no ${f}`));
  }
  assert.equal(checkSandbox({ ref: SANDBOX, allowList: [entry({ revoked: true })] }).ok, false);
  assert.equal(checkSandbox({ ref: SANDBOX, allowList: [entry(), entry()] }).ok, false);
  assert.equal(
    checkSandbox({ ref: SANDBOX, allowList: [entry({ verified_on: "10/11/2026" })] }).ok,
    false,
  );
});

test("refuses when the environment points at another project or at production (values never printed)", () => {
  const env = {
    SANDBOX_PROJECT_REF: SANDBOX,
    VITE_SUPABASE_URL: `https://${OTHER}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: OTHER, role: "service_role" }),
    SOME_NOTE: "copied from cpqihhcqeivbgxqbzatv",
  };
  const { code, text } = run(env, fakeRoot([entry()]));
  assert.equal(code, 1);
  assert.match(text, /VITE_SUPABASE_URL is a Supabase URL for another project/);
  assert.match(text, /SUPABASE_SERVICE_ROLE_KEY holds a key for another project/);
  assert.match(text, /SOME_NOTE contains a production identifier/);
  assert.ok(!text.includes(OTHER), "printed another project's ref");
  assert.ok(!text.includes("cpqihhcqeivbgxqbzatv"), "printed a production identifier");
});

test("database URLs (direct and pooler) must name the sandbox", () => {
  for (const url of [
    `postgresql://postgres:pw@db.${SANDBOX}.supabase.co:5432/postgres`,
    `postgresql://postgres:pw@db.${SANDBOX}.supabase.co:5432/postgres?sslmode=require`,
    `postgresql://postgres.${SANDBOX}:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
    `postgresql://x:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?user=postgres.${SANDBOX}`,
  ]) {
    const ok = checkSandbox({
      ref: SANDBOX,
      allowList: [entry()],
      env: { PREFLIGHT_DATABASE_URL: url },
    });
    assert.equal(ok.ok, true, `${url}\n${ok.failures.join("\n")}`);
  }
  const refused = [
    [
      `postgresql://postgres:pw@db.${OTHER}.supabase.co:5432/postgres`,
      /another project's database host/,
    ],
    [
      `postgresql://postgres.${OTHER}:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
      /pooler with another project's user/,
    ],
    // query parameters override the authority (libpq / the preflight's connEnvFromUrl)
    [
      `postgresql://postgres:pw@db.${SANDBOX}.supabase.co/postgres?host=db.${OTHER}.supabase.co`,
      /another project's database host/,
    ],
    [
      `postgresql://postgres.${SANDBOX}:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?user=postgres.${OTHER}`,
      /pooler with another project's user/,
    ],
    [
      `postgresql://postgres:pw@db.${SANDBOX}.supabase.co/postgres?hostaddr=10.0.0.5`,
      /sets hostaddr/,
    ],
    [
      `postgresql://postgres:pw@db.${SANDBOX}.supabase.co/postgres?service=prod`,
      /names a libpq service/,
    ],
    [
      `postgresql://postgres:pw@db.${SANDBOX}.supabase.co/postgres?host=db.example.com`,
      /not the sandbox's database/,
    ],
    [
      `postgresql://postgres.:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
      /pooler without a project ref/,
    ],
    [
      `postgresql://postgres:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
      /pooler without a project ref/,
    ],
    [`postgresql:///postgres`, /names no host/],
    [`postgresql://postgres:pw@localhost:5432/postgres`, /not the sandbox's database/],
    [
      `host=db.${OTHER}.supabase.co user=postgres dbname=postgres`,
      /another project's database host/,
    ],
  ];
  for (const [url, re] of refused) {
    const res = checkSandbox({ ref: SANDBOX, allowList: [entry()], env: { DATABASE_URL: url } });
    assert.equal(res.ok, false, url);
    assert.ok(
      res.failures.some((f) => re.test(f)),
      `${url}\n${res.failures.join("\n")}`,
    );
    assert.ok(
      res.failures.every((f) => !f.includes(OTHER) && !f.includes("10.0.0.5")),
      "printed a value",
    );
  }
});

test("the libpq environment (PGHOST, PGHOSTADDR, PGUSER, PGSERVICE) must name the sandbox", () => {
  const check = (env) => checkSandbox({ ref: SANDBOX, allowList: [entry()], env });
  assert.equal(check({ PGHOST: `db.${SANDBOX}.supabase.co`, PGUSER: "postgres" }).ok, true);
  assert.equal(
    check({ PGHOST: "aws-0-eu-west-1.pooler.supabase.com", PGUSER: `postgres.${SANDBOX}` }).ok,
    true,
  );
  const refused = [
    [{ PGHOST: `db.${OTHER}.supabase.co` }, /another project's database host/],
    [
      { PGHOST: `db.${SANDBOX}.supabase.co,db.${OTHER}.supabase.co` },
      /another project's database host/,
    ],
    [
      { PGHOST: "aws-0-eu-west-1.pooler.supabase.com", PGUSER: `postgres.${OTHER}` },
      /another project's user/,
    ],
    [
      { PGHOST: "aws-0-eu-west-1.pooler.supabase.com", PGUSER: "postgres." },
      /pooler without a project ref/,
    ],
    [{ PGHOST: `db.${SANDBOX}.supabase.co`, PGHOSTADDR: "10.0.0.5" }, /sets hostaddr/],
    [{ PGSERVICE: "prod" }, /names a libpq service/],
    [{ PGSERVICEFILE: "/tmp/pg_service.conf" }, /names a libpq service/],
    [{ PGUSER: `postgres.${OTHER}` }, /PGUSER names another project's pooler user/],
    [{ PGHOST: "localhost" }, /not the sandbox's database/],
  ];
  for (const [env, re] of refused) {
    const res = check(env);
    assert.equal(res.ok, false, JSON.stringify(env));
    assert.ok(
      res.failures.some((f) => re.test(f)),
      `${JSON.stringify(env)}\n${res.failures.join("\n")}`,
    );
  }
});

test("a database URL naming production is refused even with sandbox-looking parameters", () => {
  for (const id of PRODUCTION_IDENTIFIERS) {
    for (const url of [
      `postgresql://postgres:pw@db.${id}.supabase.co/postgres`,
      `postgresql://postgres:pw@db.${SANDBOX}.supabase.co/postgres?host=db.${id}.supabase.co`,
      `postgresql://postgres.${SANDBOX}:pw@aws-0-eu-west-1.pooler.supabase.com/postgres?user=postgres.${id}`,
    ]) {
      const res = checkSandbox({ ref: SANDBOX, allowList: [entry()], env: { DATABASE_URL: url } });
      assert.equal(res.ok, false, url);
      assert.ok(
        res.failures.includes("environment variable DATABASE_URL contains a production identifier"),
      );
    }
    const pg = checkSandbox({
      ref: SANDBOX,
      allowList: [entry()],
      env: { PGHOST: `db.${id}.supabase.co` },
    });
    assert.ok(pg.failures.includes("environment variable PGHOST contains a production identifier"));
  }
});

test("refuses a production ref documented in the checkout's supabase/config.toml", () => {
  const dir = fakeRoot([entry()]);
  mkdirSync(join(dir, "supabase"));
  writeFileSync(join(dir, "supabase/config.toml"), `project_id = "${SANDBOX}"\n`);
  const { code, text } = run({ SANDBOX_PROJECT_REF: SANDBOX }, dir);
  assert.equal(code, 1);
  assert.match(text, /production identifier/);
});

test("refuses a missing or malformed allow-list file", () => {
  assert.equal(run({ SANDBOX_PROJECT_REF: SANDBOX }, fakeRoot()).code, 1);
  assert.equal(run({ SANDBOX_PROJECT_REF: SANDBOX }, fakeRoot({ sandboxes: [] })).code, 1);
});

test("passes only for a complete, owner-verified entry with a consistent environment", () => {
  const env = {
    SANDBOX_PROJECT_REF: SANDBOX,
    VITE_SUPABASE_URL: `https://${SANDBOX}.supabase.co`,
    VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ ref: SANDBOX, role: "anon" }),
  };
  const { code, text } = run(env, fakeRoot([entry()]));
  assert.equal(code, 0, text);
  assert.match(text, /OK: sandbox abcdefghijklmnopqrst .*Nothing was contacted/);
});

test("the guard imports nothing that can reach the network or a database", () => {
  const src = readFileSync(join(ROOT, "scripts/rehearsal-guard.mjs"), "utf8");
  const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["node:fs", "node:path", "node:url"]);
  assert.doesNotMatch(src, /\bfetch\(|child_process|node:net|node:http|psql|createClient/);
});

test("R5 review F1: repeated or percent-encoded libpq parameters cannot redirect a sandbox URL", () => {
  const [prod] = PRODUCTION_IDENTIFIERS;
  const enc = (id) => `%${id.charCodeAt(0).toString(16)}${id.slice(1)}`;
  const urls = [
    `postgresql://postgres:pw@db.${SANDBOX}.supabase.co/postgres?host=db.${SANDBOX}.supabase.co&host=db.${enc(prod)}.supabase.co`,
    `postgresql://postgres:pw@db.${SANDBOX}.supabase.co/postgres?host=db.${SANDBOX}.supabase.co&host=db.zyxwvutsrqponmlkjihg.supabase.co`,
    `postgresql://postgres.${SANDBOX}:pw@aws-0-eu-west-1.pooler.supabase.com/postgres?user=postgres.${SANDBOX}&user=postgres.${enc(prod)}`,
    `postgresql://postgres:pw@db.${enc(prod)}.supabase.co/postgres`,
    `postgresql://postgres.${enc(prod)}:pw@aws-0-eu-west-1.pooler.supabase.com/postgres`,
  ];
  for (const url of urls) {
    const res = checkSandbox({ ref: SANDBOX, allowList: [entry()], env: { DATABASE_URL: url } });
    assert.equal(res.ok, false, url);
  }
  const ci = checkSandbox({
    ref: SANDBOX,
    allowList: [entry()],
    env: {
      DB: `host=db.${SANDBOX}.supabase.co host=db.zyxwvutsrqponmlkjihg.supabase.co user=postgres`,
    },
  });
  assert.equal(ci.ok, false);
  // the plain sandbox URL still passes
  const ok = checkSandbox({
    ref: SANDBOX,
    allowList: [entry()],
    env: {
      DATABASE_URL: `postgresql://postgres:pw@db.${SANDBOX}.supabase.co/postgres?sslmode=require`,
    },
  });
  assert.deepEqual(ok.failures, []);
});
