#!/usr/bin/env node
// Local Supabase backend for the Playwright E2E suite, in Docker on this machine.
//
//   node e2e/local-stack/stack.mjs up      start fresh: db, auth, (realtime), migrations, rest, gateway
//   node e2e/local-stack/stack.mjs down    stop everything and delete the database
//   node e2e/local-stack/stack.mjs env     print the `export` lines for the running stack
//
// `up` always starts from an empty database: it removes any previous stack, generates a new
// JWT secret and database password, mints anon and service_role keys from that secret, and
// writes them to e2e/local-stack/.state/ (git-ignored, mode 600). Nothing is reused between
// runs and nothing it generates is a credential for anything but this throwaway stack.
//
// The schema is built the way the CI replay builds it (scripts/db-test.mjs): every migration in
// supabase/migrations and drizzle/migrations, in scripts/migration-order.mjs order, with known
// twins skipped (scripts/migration-twins.mjs). Unlike db-test it does not load the platform stub
// (supabase/tests/support/supabase-stub.sql): the supabase/postgres image and GoTrue provide the
// real auth and storage schemas and roles.
//
// See README.md in this folder.
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationOrder } from "../../scripts/migration-order.mjs";
import { dedupeMigrations } from "../../scripts/migration-twins.mjs";
import { envExports, generateSecrets, localApiKeys } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const stateDir = join(here, ".state");
const composeFile = join(here, "docker-compose.yml");
const composeEnv = join(stateDir, "compose.env");

const PORTS = { api: 54321, db: 54322, auth: 54331, rest: 54332, realtime: 54333, storage: 54334 };
const API_URL = `http://127.0.0.1:${PORTS.api}`;
const SITE_URL = "http://localhost:8080";
const IMAGES = {
  realtime: "supabase/realtime:v2.51.11",
  storage: "supabase/storage-api:v1.28.0",
};
const REALTIME_RUNTIME = "/app/releases/2.51.11/runtime.exs";

const log = (msg) => console.log(`[local-stack] ${msg}`);
function die(msg, detail) {
  console.error(`[local-stack] ${msg}`);
  if (detail) console.error(String(detail).trim().split("\n").slice(-15).join("\n"));
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}

function compose(args, { profiles = [] } = {}) {
  const envFile = existsSync(composeEnv) ? ["--env-file", composeEnv] : [];
  const profileArgs = profiles.flatMap((p) => ["--profile", p]);
  return run("docker", ["compose", "-f", composeFile, ...envFile, ...profileArgs, ...args]);
}

function imagePresent(image) {
  return run("docker", ["image", "inspect", image]).status === 0;
}

/** psql against the stack's database, as `postgres`, with nothing inherited but PATH/HOME. */
function psql(password, args, input) {
  return run("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], {
    input,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      PGHOST: "127.0.0.1",
      PGPORT: String(PORTS.db),
      PGUSER: "postgres",
      PGDATABASE: "postgres",
      PGPASSWORD: password,
      PGCONNECT_TIMEOUT: "5",
    },
  });
}

async function waitFor(what, check, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < until) {
    try {
      const r = await check();
      if (r === true) return;
      last = r || last;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await sleep(1000);
  }
  die(`Timed out waiting for ${what}.`, last);
}

async function httpOk(url, init) {
  const res = await fetch(url, init);
  return res.ok ? true : `${url} -> ${res.status}`;
}

function readState() {
  try {
    return JSON.parse(readFileSync(join(stateDir, "stack.json"), "utf8"));
  } catch {
    return null;
  }
}

function stopGateway() {
  const state = readState();
  if (!state?.gatewayPid) return;
  try {
    process.kill(state.gatewayPid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

function down() {
  stopGateway();
  if (existsSync(composeEnv)) {
    const r = compose(["down", "-v", "--remove-orphans"], { profiles: ["realtime", "storage"] });
    if (r.status !== 0) die("docker compose down failed.", r.stderr);
  } else {
    // No env file means no stack started by this script; remove by project name in case.
    run("docker", ["compose", "-p", "ballacity-e2e-local", "down", "-v", "--remove-orphans"]);
  }
  rmSync(stateDir, { recursive: true, force: true });
  log("Stopped and removed.");
}

function applyMigrations(password) {
  let order;
  try {
    order = dedupeMigrations(migrationOrder(root));
  } catch (e) {
    die(e instanceof Error ? e.message : String(e));
  }
  if (order.skipped.length > 0)
    log(`Skipping ${order.skipped.length} known identical twin migrations (applied once).`);
  const started = Date.now();
  for (const m of order.replay) {
    const r = psql(password, ["-1"], readFileSync(m.path, "utf8"));
    if (r.status !== 0) die(`Migration failed to apply: ${m.name}`, r.stderr);
  }
  log(
    `Applied ${order.replay.length} migrations in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
  );
}

async function up() {
  if (run("docker", ["info"]).status !== 0)
    die("Docker is not reachable. Start dockerd and retry.");
  if (run("psql", ["--version"]).status !== 0) die("psql is not on the PATH.");

  if (existsSync(stateDir) || compose(["ps", "-q"]).stdout?.trim()) {
    log("Removing the previous stack.");
    down();
  }
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });

  const secrets = generateSecrets();
  const keys = localApiKeys(secrets.jwtSecret);
  const withRealtime = imagePresent(IMAGES.realtime);
  const withStorage = imagePresent(IMAGES.storage);

  writeFileSync(
    composeEnv,
    [
      `LOCAL_DB_PASSWORD=${secrets.dbPassword}`,
      `LOCAL_JWT_SECRET=${secrets.jwtSecret}`,
      `LOCAL_REALTIME_ENC_KEY=${secrets.realtimeEncKey}`,
      `LOCAL_REALTIME_SECRET_KEY_BASE=${secrets.realtimeSecretKeyBase}`,
      `LOCAL_API_URL=${API_URL}`,
      `LOCAL_SITE_URL=${SITE_URL}`,
      `LOCAL_DB_PORT=${PORTS.db}`,
      `LOCAL_AUTH_PORT=${PORTS.auth}`,
      `LOCAL_REST_PORT=${PORTS.rest}`,
      `LOCAL_REALTIME_PORT=${PORTS.realtime}`,
      `LOCAL_STORAGE_PORT=${PORTS.storage}`,
      `LOCAL_ANON_KEY=${keys.anon}`,
      `LOCAL_SERVICE_ROLE_KEY=${keys.serviceRole}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  chmodSync(composeEnv, 0o600);

  log("Starting Postgres (supabase/postgres).");
  let r = compose(["up", "-d", "--wait", "db"]);
  if (r.status !== 0) die("Postgres did not start.", r.stderr);
  await waitFor("Postgres to accept connections", () => {
    const p = psql(secrets.dbPassword, ["-At", "-c", "select 1"]);
    return p.status === 0 ? true : p.stderr;
  });

  log("Starting Auth (GoTrue); it migrates the auth schema.");
  r = compose(["up", "-d", "auth"]);
  if (r.status !== 0) die("Auth did not start.", r.stderr);
  await waitFor("Auth", () => httpOk(`http://127.0.0.1:${PORTS.auth}/health`));

  if (withRealtime) {
    // Realtime's HTTP listener is hard-coded to IPv6, which fails ("eafnosupport") on a kernel
    // without IPv6. Mount a copy of its runtime config that listens on IPv4 instead.
    const exs = run("docker", [
      "run",
      "--rm",
      "--entrypoint",
      "cat",
      IMAGES.realtime,
      REALTIME_RUNTIME,
    ]);
    if (exs.status !== 0 || !exs.stdout.includes("socket_opts: [:inet6]"))
      die("Could not read Realtime's runtime config to switch it to IPv4.", exs.stderr);
    writeFileSync(
      join(stateDir, "realtime-runtime.exs"),
      exs.stdout.replace("socket_opts: [:inet6]", "socket_opts: [:inet]"),
    );
    log("Starting Realtime; it creates realtime.messages, which the migrations add policies to.");
    r = compose(["up", "-d", "realtime"], { profiles: ["realtime"] });
    if (r.status !== 0) die("Realtime did not start.", r.stderr);
    await waitFor(
      "Realtime to create realtime.messages",
      async () => {
        // A tenant health check makes Realtime connect to the tenant and run its migrations.
        await fetch(`http://127.0.0.1:${PORTS.realtime}/api/tenants/realtime-dev/health`, {
          headers: { authorization: `Bearer ${keys.serviceRole}` },
        }).catch(() => null);
        const p = psql(secrets.dbPassword, [
          "-At",
          "-c",
          "select to_regclass('realtime.messages') is not null",
        ]);
        return p.stdout.trim() === "t" ? true : "realtime.messages not there yet";
      },
      180_000,
    );
  } else {
    log(
      `Realtime image ${IMAGES.realtime} is not available: realtime specs will fail. ` +
        "Creating a stand-in realtime.messages so the migrations' policies apply.",
    );
    r = psql(
      secrets.dbPassword,
      [],
      `CREATE TABLE IF NOT EXISTS realtime.messages (id bigserial PRIMARY KEY, topic text, extension text,
         payload jsonb, event text, private boolean, inserted_at timestamptz DEFAULT now(),
         updated_at timestamptz DEFAULT now());`,
    );
    if (r.status !== 0) die("Could not create realtime.messages.", r.stderr);
  }

  if (withStorage) {
    log("Starting Storage; it migrates the storage schema the migrations create buckets in.");
    r = compose(["up", "-d", "storage"], { profiles: ["storage"] });
    if (r.status !== 0) die("Storage did not start.", r.stderr);
    await waitFor("Storage", () => httpOk(`http://127.0.0.1:${PORTS.storage}/status`));
  } else {
    die(
      `Storage image ${IMAGES.storage} is not available. The migrations create storage buckets ` +
        "with columns only its own migrations add, so the schema cannot be built without it. " +
        `Pull it (docker pull ${IMAGES.storage}) and retry.`,
    );
  }

  log("Applying the repository's migrations (CI replay order).");
  applyMigrations(secrets.dbPassword);

  log("Starting the REST API (PostgREST).");
  r = compose(["up", "-d", "rest"]);
  if (r.status !== 0) die("PostgREST did not start.", r.stderr);
  await waitFor("PostgREST", () =>
    httpOk(`http://127.0.0.1:${PORTS.rest}/`, {
      headers: { authorization: `Bearer ${keys.anon}` },
    }),
  );

  log(`Starting the API gateway on ${API_URL}.`);
  const upstreams = {
    auth: `http://127.0.0.1:${PORTS.auth}`,
    rest: `http://127.0.0.1:${PORTS.rest}`,
    ...(withRealtime ? { realtime: `http://127.0.0.1:${PORTS.realtime}` } : {}),
    ...(withStorage ? { storage: `http://127.0.0.1:${PORTS.storage}` } : {}),
  };
  const logFd = openSync(join(stateDir, "gateway.log"), "a");
  const gateway = spawn(process.execPath, [join(here, "gateway.mjs")], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      PATH: process.env.PATH ?? "",
      LOCAL_GATEWAY_CONFIG: JSON.stringify({
        port: PORTS.api,
        upstreams,
        apiKeys: [keys.anon, keys.serviceRole],
      }),
    },
  });
  gateway.unref();
  writeFileSync(
    join(stateDir, "stack.json"),
    JSON.stringify(
      { gatewayPid: gateway.pid, apiUrl: API_URL, withRealtime, withStorage },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await waitFor("the gateway", () =>
    httpOk(`${API_URL}/auth/v1/health`, { headers: { apikey: keys.anon } }),
  );

  const exportsText = envExports({ apiUrl: API_URL, keys, baseUrl: SITE_URL });
  writeFileSync(join(stateDir, "env.sh"), `${exportsText}\n`, { mode: 0o600 });
  log(
    `Ready. Services: postgres, auth, rest${withRealtime ? ", realtime" : ""}${withStorage ? ", storage" : ""}.`,
  );
  log(`Load the environment with:  source ${join("e2e/local-stack/.state/env.sh")}`);
}

const cmd = process.argv[2];
if (cmd === "up") await up();
else if (cmd === "down") down();
else if (cmd === "env") {
  const f = join(stateDir, "env.sh");
  if (!existsSync(f)) die("The stack is not running (no .state/env.sh). Run `up` first.");
  process.stdout.write(readFileSync(f, "utf8"));
} else {
  console.error("usage: node e2e/local-stack/stack.mjs up|down|env");
  process.exit(2);
}
