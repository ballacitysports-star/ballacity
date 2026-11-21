import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  SCRATCH_MARKER,
  existingDatabaseProblems,
  scrubbedEnv,
  serverProblems,
  targetProblems,
} from "./db-test-target.mjs";

// A made-up project ref in Supabase's shape. Nothing here ever connects: the scripts run below get a fake psql.
const FAKE_REF = "zzzzfakeprojectrefzz";

const ok = (env, db = "ballacity_dbtest") => expect(targetProblems(env, db)).toEqual([]);
const refused = (env, db = "ballacity_dbtest") =>
  expect(targetProblems(env, db).length).toBeGreaterThan(0);

describe("db-test target: environment", () => {
  it("accepts the default local socket, a socket directory and loopback hosts (CI uses localhost)", () => {
    ok({});
    ok({ PGHOST: "/var/run/postgresql" });
    for (const h of ["localhost", "127.0.0.1", "::1", "[::1]", "127.0.0.2"])
      ok({ PGHOST: h, PGPORT: "5432" });
    ok({ PGHOST: "localhost", PGHOSTADDR: "127.0.0.1" });
  });

  it("refuses remote hosts, including production and pooler hosts", () => {
    for (const h of [
      `db.${FAKE_REF}.supabase.co`,
      "aws-0-eu-west-1.pooler.supabase.com",
      "10.0.0.5",
      "192.168.1.10",
      "example.com",
      "localhost.example.com",
    ])
      refused({ PGHOST: h });
  });

  it("refuses several hosts, a remote PGHOSTADDR, and service files", () => {
    refused({ PGHOST: "localhost,db.example.com" });
    refused({ PGHOST: "/tmp,localhost" });
    refused({ PGHOSTADDR: "10.1.2.3" });
    refused({ PGHOST: "localhost", PGHOSTADDR: "203.0.113.9" });
    refused({ PGHOSTADDR: "127.0.0.1,10.0.0.1" });
    refused({ PGSERVICE: "prod" });
    refused({ PGSERVICEFILE: "/home/me/.pg_service.conf" });
    refused({ PGDATABASE: "host=db.example.com dbname=postgres" });
  });

  it("refuses an environment wired to a remote database even when PGHOST is local (Lovable's agent workspace)", () => {
    const remoteUrls = [
      `postgresql://postgres:secret@db.${FAKE_REF}.supabase.co:5432/postgres`,
      `postgres://postgres.${FAKE_REF}:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
      "postgresql://localhost,db.example.com/app",
      "postgresql://localhost/app?host=db.example.com",
      "postgresql://localhost/app?hostaddr=203.0.113.9",
      "not a url",
    ];
    for (const k of ["DATABASE_URL", "SUPABASE_DB_URL", "POSTGRES_URL"])
      for (const v of remoteUrls) {
        refused({ [k]: v });
        refused({ PGHOST: "127.0.0.1", PGPORT: "54329", [k]: v });
      }
    // Any other variable holding a remote postgres:// URL, whatever its name (Lovable's tooling sets DB_URL and
    // LOVABLE_DB_MIGRATION_URL).
    for (const k of ["DB_URL", "LOVABLE_DB_MIGRATION_URL", "SOME_OTHER_PG_URL"])
      for (const v of remoteUrls.filter((u) => /^postgres/.test(u)))
        refused({ PGHOST: "127.0.0.1", PGPORT: "54329", [k]: v });
    ok({
      PGHOST: "127.0.0.1",
      PGPORT: "54329",
      LOVABLE_DB_MIGRATION_URL: "postgresql://u@localhost/app",
    });
    // A variable that is not a postgres URL is not a database setting.
    ok({ PGHOST: "127.0.0.1", PGPORT: "54329", SITE_URL: "https://ballacity.example" });
    refused({ PGUSER: `postgres.${FAKE_REF}` });
    refused({ PGHOST: "localhost", PGUSER: `supabase_admin.${FAKE_REF}` });
    refused({ PGHOST: `db.${FAKE_REF}.supabase.co`, PGUSER: "postgres", PGPASSWORD: "x" });
  });

  it("accepts a local DATABASE_URL and ordinary local user names", () => {
    ok({ DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app" });
    ok({ DATABASE_URL: "postgres://u@127.0.0.1:54329/app" });
    ok({ DATABASE_URL: "postgresql:///app?host=/var/run/postgresql" });
    ok({ DATABASE_URL: "" });
    for (const u of ["postgres", "runner", "dev.user"]) ok({ PGHOST: "localhost", PGUSER: u });
  });

  it("refuses database names that are connection strings, URIs or reserved", () => {
    for (const db of [
      "postgresql://postgres@db.example.com/postgres",
      "host=db.example.com dbname=x",
      "service=prod",
      "a b",
      "Upper",
      "x".repeat(64),
      "",
      "postgres",
      "template0",
      "template1",
    ])
      refused({}, db);
    ok({}, "r9final");
    ok({}, "ballacity_dbtest");
  });

  it("strips service settings from the environment psql runs with", () => {
    const env = scrubbedEnv({
      PGSERVICE: "prod",
      PGSERVICEFILE: "/x",
      PGDATABASE: "y",
      PGUSER: "postgres",
    });
    expect(env).toEqual({ PGUSER: "postgres" });
  });
});

describe("db-test target: what the server reports", () => {
  it("accepts a socket (no address) or loopback, plain Postgres", () => {
    expect(serverProblems({ serverAddr: null, managedRoles: [] })).toEqual([]);
    expect(serverProblems({ serverAddr: "127.0.0.1", managedRoles: [] })).toEqual([]);
    expect(serverProblems({ serverAddr: "::1", managedRoles: [] })).toEqual([]);
  });

  const fresh = [
    { name: "postgres", comment: "" },
    { name: "template0", comment: "" },
    { name: "template1", comment: "" },
  ];

  it("accepts a fresh Docker or CI service container behind a loopback port mapping", () => {
    for (const a of ["172.18.0.2", "10.0.0.5", "192.168.65.2", "fd00::2"])
      expect(serverProblems({ serverAddr: a, managedRoles: [], databases: fresh })).toEqual([]);
    const withScratch = [...fresh, { name: "ballacity_dbtest", comment: SCRATCH_MARKER }];
    expect(
      serverProblems({ serverAddr: "172.18.0.2", managedRoles: [], databases: withScratch }),
    ).toEqual([]);
  });

  it("refuses a private address that holds data db-test did not create (a tunnel to a remote private server)", () => {
    const remote = [...fresh, { name: "app_production", comment: "" }];
    expect(
      serverProblems({ serverAddr: "10.0.0.5", managedRoles: [], databases: remote }).length,
    ).toBe(1);
    expect(
      serverProblems({
        serverAddr: "172.18.0.2",
        managedRoles: [],
        databases: fresh,
        postgresUserTables: 3,
      }).length,
    ).toBe(1);
  });

  it("does not require an empty cluster for a server on this machine (socket or loopback)", () => {
    const busy = [...fresh, { name: "my_local_app", comment: "" }];
    expect(
      serverProblems({
        serverAddr: null,
        managedRoles: [],
        databases: busy,
        postgresUserTables: 9,
      }),
    ).toEqual([]);
    expect(serverProblems({ serverAddr: "127.0.0.1", managedRoles: [], databases: busy })).toEqual(
      [],
    );
  });

  it("refuses a public server address (the loopback port is a tunnel to a remote server)", () => {
    for (const a of ["203.0.113.9", "52.1.2.3", "2600:1f18::1"])
      expect(
        serverProblems({ serverAddr: a, managedRoles: [], databases: fresh }).length,
      ).toBeGreaterThan(0);
  });

  it("refuses a Supabase-managed cluster even when reached locally", () => {
    expect(serverProblems({ serverAddr: null, managedRoles: ["supabase_admin"] }).length).toBe(1);
    expect(
      serverProblems({ serverAddr: "127.0.0.1", managedRoles: ["authenticator"] }).length,
    ).toBe(1);
  });
});

describe("db-test target: existing databases", () => {
  it("drops or reuses only a database it created", () => {
    expect(existingDatabaseProblems({ exists: false, comment: "" })).toEqual([]);
    expect(existingDatabaseProblems({ exists: true, comment: SCRATCH_MARKER })).toEqual([]);
    expect(existingDatabaseProblems({ exists: true, comment: "" }).length).toBe(1);
    expect(existingDatabaseProblems({ exists: true, comment: "my local app data" }).length).toBe(1);
  });
});

describe("db-test refuses before connecting", () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), "db-test.mjs");
  // A fake psql first on the PATH: it records each call and fails, so no run here reaches any server, and a refusal
  // can be shown to have sent nothing at all (no SHOW, DROP or CREATE).
  const shimDir = mkdtempSync(join(tmpdir(), "db-test-guard-"));
  const callLog = join(shimDir, "psql-calls.log");
  writeFileSync(join(shimDir, "psql"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${callLog}"\nexit 1\n`);
  chmodSync(join(shimDir, "psql"), 0o755);
  afterAll(() => rmSync(shimDir, { recursive: true, force: true }));

  const run = (env, args = []) => {
    rmSync(callLog, { force: true });
    return spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: { PATH: `${shimDir}:${process.env.PATH}`, ...env },
      timeout: 20_000,
    });
  };
  const psqlCalls = () => (existsSync(callLog) ? readFileSync(callLog, "utf8") : "");

  it("exits 2 for a remote host without running psql", () => {
    const r = run({ PGHOST: `db.${FAKE_REF}.supabase.co`, PGUSER: "postgres", PGPASSWORD: "x" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/db-test refused/);
    expect(r.stderr).not.toMatch(new RegExp(FAKE_REF)); // reasons never echo the value
    expect(psqlCalls()).toBe("");
  });

  it("exits 2 for a pooler host with any flags (--replay-only, --keep, --reuse, --db) without running psql", () => {
    for (const args of [[], ["--replay-only", "--keep"], ["--reuse"], ["--db", "dev_scratch"]]) {
      const r = run({ PGHOST: "aws-0-eu-west-1.pooler.supabase.com", PGPORT: "6543" }, args);
      expect(r.status).toBe(2);
      expect(psqlCalls()).toBe("");
    }
  });

  it("exits 2 for a remote DATABASE_URL or a pooler PGUSER next to a local PGHOST, without running psql", () => {
    for (const env of [
      {
        PGHOST: "127.0.0.1",
        DATABASE_URL: `postgresql://postgres:x@db.${FAKE_REF}.supabase.co/postgres`,
      },
      { PGHOST: "127.0.0.1", PGUSER: `postgres.${FAKE_REF}` },
    ]) {
      const r = run(env);
      expect(r.status).toBe(2);
      expect(r.stderr).not.toMatch(new RegExp(FAKE_REF));
      expect(psqlCalls()).toBe("");
    }
  });

  it("exits 2 for a connection string passed as --db", () => {
    const r = run({}, ["--db", "host=db.example.com dbname=postgres"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/plain lower-case identifier/);
    expect(psqlCalls()).toBe("");
  });

  it("exits 2 for a service file", () => {
    expect(run({ PGSERVICE: "prod" }).status).toBe(2);
    expect(psqlCalls()).toBe("");
  });

  it("control: a local target gets past the guard, and its first query is the read-only identity probe", () => {
    const r = run({ PGHOST: "127.0.0.1", PGUSER: "postgres" }, ["--db", "dev_scratch"]);
    expect(r.status).toBe(1); // the fake psql fails, so the run stops at "Cannot connect"
    expect(r.stderr).toMatch(/Cannot connect to Postgres/);
    const calls = psqlCalls().trim().split("\n");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/-d postgres .*SELECT coalesce\(host\(inet_server_addr\(\)\)/);
    expect(calls[0]).not.toMatch(/SHOW|DROP|CREATE/);
  });
});
