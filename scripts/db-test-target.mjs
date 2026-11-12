// Fail-closed target guard for scripts/db-test.mjs.
//
// db-test DROPs and CREATEs a database, replays every migration into it and runs tests that write rows, grant
// privileges and alter cluster-wide roles (supabase/tests/support/supabase-stub.sql). That is only safe on a
// throwaway local Postgres. Everything that decides where libpq connects is checked here, before any connection:
//
//   - PGHOST: unset (the default local socket), an absolute socket directory, or a loopback name/address. Several
//     hosts (a comma list) are refused: libpq would try each in turn.
//   - PGHOSTADDR: unset or loopback. PGSERVICE / PGSERVICEFILE: refused (a service can point anywhere).
//   - DATABASE_URL, SUPABASE_DB_URL, POSTGRES_URL: psql never reads them, but one that names a remote server marks an
//     environment wired to a real database (Lovable's agent workspace ran this script with production's PG* set), so
//     it is refused too; likewise a PGUSER in Supabase's pooler form (role.project_ref).
//   - The database name: a plain identifier (never a conninfo string or a URI, which psql -d would honour), not a
//     reserved database, at most 63 characters.
// After connecting, the server must not report a public address (a tunnel elsewhere) and must not be a Supabase-managed
// cluster (role supabase_admin or authenticator), and an existing database is only dropped or reused when the
// harness created it (it carries the scratch marker comment).
//
// There is no override flag. To use a different local database, pass --db <name>.

export const SCRATCH_MARKER = "ballacity db-test scratch database (safe to drop)";

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const RESERVED_DATABASES = new Set(["postgres", "template0", "template1"]);
const DB_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const DATABASE_URL_VARS = ["DATABASE_URL", "SUPABASE_DB_URL", "POSTGRES_URL"];
// Supabase's pooler logs in as <role>.<project ref>; a project ref is 20 lower-case letters.
const POOLER_USER = /^[a-z_][a-z0-9_]*\.[a-z]{20}$/;

function isLoopbackAddress(a) {
  const v = String(a)
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (v === "::1" || v === "0:0:0:0:0:0:0:1") return true;
  const m = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  return !!m && Number(m[1]) === 127 && [m[2], m[3], m[4]].every((x) => Number(x) <= 255);
}

/** A socket directory or a loopback name/address. */
function isLocalHost(h) {
  return h.startsWith("/") || LOOPBACK_NAMES.has(h.toLowerCase()) || isLoopbackAddress(h);
}

/** Every host a connection URL names (its authority, host= and hostaddr=); null when it does not parse. */
function urlHosts(value) {
  try {
    const url = new URL(value.trim());
    return [
      url.hostname,
      ...url.searchParams.getAll("host"),
      ...url.searchParams.getAll("hostaddr"),
    ]
      .flatMap((h) => decodeURIComponent(h).split(","))
      .map((h) => h.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

/** Pure check of the environment and database name. Returns a list of reasons; empty means acceptable. */
export function targetProblems(env, dbName) {
  const problems = [];
  const set = (k) => typeof env[k] === "string" && env[k].trim() !== "";

  if (set("PGSERVICE") || set("PGSERVICEFILE"))
    problems.push(
      "PGSERVICE/PGSERVICEFILE is set: a libpq service can point at any server. Unset it.",
    );
  if (set("PGHOST")) {
    const hosts = env.PGHOST.split(",").map((h) => h.trim());
    if (hosts.length > 1) problems.push("PGHOST lists several hosts; use exactly one local host.");
    for (const h of hosts) {
      if (!isLocalHost(h))
        problems.push(`PGHOST is not a local socket directory or loopback host.`);
    }
  }
  if (set("PGHOSTADDR")) {
    const addrs = env.PGHOSTADDR.split(",").map((h) => h.trim());
    if (addrs.length > 1 || !addrs.every(isLoopbackAddress))
      problems.push("PGHOSTADDR is not a single loopback address.");
  }
  for (const k of DATABASE_URL_VARS) {
    if (!set(k)) continue;
    const hosts = urlHosts(env[k]);
    if (!hosts || !hosts.every(isLocalHost))
      problems.push(
        `${k} names a server that is not local: this environment is wired to a real database. Unset it.`,
      );
  }
  if (set("PGUSER") && POOLER_USER.test(env.PGUSER.trim()))
    problems.push(
      "PGUSER has the form of a Supabase pooler login (role.project_ref): this environment is wired to a real database.",
    );
  if (set("PGDATABASE") && /[=\s/:@]/.test(env.PGDATABASE))
    problems.push("PGDATABASE looks like a connection string; unset it.");

  const name = String(dbName ?? "");
  if (!DB_NAME.test(name))
    problems.push(
      "The database name must be a plain lower-case identifier (letters, digits, underscore; at most 63 characters), never a connection string.",
    );
  else if (RESERVED_DATABASES.has(name))
    problems.push(`"${name}" is a reserved database and is never dropped or reused.`);
  return problems;
}

/**
 * A container or private-network address: what a local Docker or CI service container reports for itself when
 * the client reached it through a loopback port mapping (the client side is already loopback-only).
 */
function isPrivateAddress(a) {
  const v = String(a)
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const m = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(v);
  if (m) {
    const [a1, a2] = [Number(m[1]), Number(m[2])];
    return a1 === 10 || (a1 === 172 && a2 >= 16 && a2 <= 31) || (a1 === 192 && a2 === 168);
  }
  return /^f[cd][0-9a-f]{2}:/.test(v) || /^fe80:/.test(v);
}

/**
 * Pure check of what the server reported after connecting. The client side already allows only a socket or a
 * loopback host.
 *  - Socket or loopback server address: a Postgres on this machine. Accepted.
 *  - Private address (a Docker or CI service container behind a loopback port mapping, which is how CI runs):
 *    accepted ONLY if the cluster is visibly disposable, because an SSH tunnel to a remote database on a private
 *    network looks the same from here. Disposable means: no database other than postgres/template0/template1 and
 *    scratch databases db-test itself created (scratch marker), and no tables of its own in the postgres database.
 *  - Public address: the loopback port is forwarded somewhere else. Refused.
 * A Supabase-managed cluster (supabase_admin / authenticator roles) is refused whatever its address.
 */
export function serverProblems({
  serverAddr,
  managedRoles,
  databases = [],
  postgresUserTables = 0,
}) {
  const problems = [];
  const local = !serverAddr || isLoopbackAddress(serverAddr);
  if (!local && !isPrivateAddress(serverAddr))
    problems.push(
      "The server reports a public network address: the loopback connection is forwarded somewhere else.",
    );
  if (!local && isPrivateAddress(serverAddr)) {
    const foreign = databases.filter(
      (d) => !RESERVED_DATABASES.has(d.name) && d.comment !== SCRATCH_MARKER,
    );
    if (foreign.length > 0 || postgresUserTables > 0)
      problems.push(
        "The server is reached through a forwarded port and holds databases or tables db-test did not create. Only an empty, disposable container is accepted this way (a tunnel to a remote server looks the same).",
      );
  }
  if (managedRoles && managedRoles.length > 0)
    problems.push(
      "The server looks like a Supabase-managed cluster (it has supabase_admin/authenticator). db-test runs only on a plain scratch Postgres.",
    );
  return problems;
}

/** An existing database may be dropped or reused only when this harness created it. */
export function existingDatabaseProblems({ exists, comment }) {
  if (!exists) return [];
  if (comment === SCRATCH_MARKER) return [];
  return [
    "A database with this name already exists and was not created by db-test (no scratch marker). It is never dropped or reused; pass another --db name, or drop it yourself if it really is disposable.",
  ];
}

/** The environment psql is run with: service settings removed, so nothing but the checked variables decides the target. */
export function scrubbedEnv(env) {
  const out = { ...env };
  delete out.PGSERVICE;
  delete out.PGSERVICEFILE;
  delete out.PGDATABASE;
  return out;
}
