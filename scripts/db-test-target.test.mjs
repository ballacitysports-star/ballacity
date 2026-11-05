import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SCRATCH_MARKER,
  existingDatabaseProblems,
  scrubbedEnv,
  serverProblems,
  targetProblems,
} from "./db-test-target.mjs";

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
      "db.cpqihhcqeivbgxqbzatv.supabase.co",
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

  it("accepts the private address a Docker or CI service container reports behind a loopback port mapping", () => {
    for (const a of ["172.18.0.2", "10.0.0.5", "192.168.65.2", "fd00::2"])
      expect(serverProblems({ serverAddr: a, managedRoles: [] })).toEqual([]);
  });

  it("refuses a public server address (the loopback port is a tunnel to a remote server)", () => {
    for (const a of ["203.0.113.9", "52.1.2.3", "2600:1f18::1"])
      expect(serverProblems({ serverAddr: a, managedRoles: [] }).length).toBe(1);
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
  const run = (env, args = []) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, ...env },
      timeout: 20_000,
    });

  it("exits 2 for a remote host without running psql", () => {
    const r = run({ PGHOST: "db.cpqihhcqeivbgxqbzatv.supabase.co" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/db-test refused/);
    expect(r.stderr).not.toMatch(/cpqihhcqeivbgxqbzatv/); // reasons never echo the value
  });

  it("exits 2 for a connection string passed as --db", () => {
    const r = run({}, ["--db", "host=db.example.com dbname=postgres"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/plain lower-case identifier/);
  });

  it("exits 2 for a service file", () => {
    expect(run({ PGSERVICE: "prod" }).status).toBe(2);
  });
});
