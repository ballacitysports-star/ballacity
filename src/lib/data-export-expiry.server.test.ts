import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The route's service-role client: each test points it at its own fake database and bucket.
const shared = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return shared.admin;
  },
}));

import { expireDataExports, FILE_BATCH, type ExpiryAdmin } from "./data-export-expiry.server";
import { Route } from "@/routes/api/public/data-exports/expire";

const HOUR = 3600_000;
const NOW = Date.UTC(2026, 10, 27, 4, 27);

type Row = {
  id: string;
  user_id: string;
  status: "requested" | "processing" | "ready" | "expired" | "failed";
  storage_path: string | null;
  ready_at: number | null;
  expires_at: number | null;
};

// The rules of 20261205110000, as the SQL test checks them: the fake answers what the database would.
const lapsed = (r: Row) =>
  (r.expires_at != null && r.expires_at < NOW) ||
  (r.ready_at != null && r.ready_at < NOW - 24 * HOUR);
const due = (r: Row) =>
  r.storage_path != null &&
  (r.status === "expired" || r.status === "failed") &&
  lapsed(r) &&
  r.storage_path === `${r.user_id}/${r.id}.json`;

function exportRow(
  status: Row["status"],
  readyHoursAgo: number | null,
  opts: { file?: boolean; path?: string } = {},
): Row {
  const id = randomUUID();
  const user_id = randomUUID();
  const ready_at = readyHoursAgo == null ? null : NOW - readyHoursAgo * HOUR;
  return {
    id,
    user_id,
    status,
    storage_path: opts.path ?? (opts.file === false ? null : `${user_id}/${id}.json`),
    ready_at,
    expires_at: ready_at == null ? null : ready_at + 24 * HOUR,
  };
}

type Fake = {
  admin: ExpiryAdmin;
  rows: Row[];
  bucket: Set<string>;
  removes: string[][];
  buckets: string[];
  rpcs: string[];
};

function fakeBackend(
  rows: Row[],
  opts: {
    rpcError?: Partial<Record<string, { code: string; message: string }>>;
    removeError?: (call: number) => unknown;
    removeThrows?: (call: number) => boolean;
    missing?: string[];
  } = {},
): Fake {
  const bucket = new Set(
    rows.map((r) => r.storage_path).filter((p): p is string => !!p && !opts.missing?.includes(p)),
  );
  const fake: Fake = { admin: null as never, rows, bucket, removes: [], buckets: [], rpcs: [] };
  fake.admin = {
    rpc: async (fn, args) => {
      fake.rpcs.push(fn);
      const err = opts.rpcError?.[fn];
      if (err) return { data: null, error: err };
      switch (fn) {
        case "check_worker_secret":
          return { data: false, error: null };
        case "expire_stale_data_exports": {
          let n = 0;
          for (const r of rows) {
            if (["ready", "processing", "requested"].includes(r.status) && lapsed(r)) {
              r.status = "expired";
              n += 1;
            }
          }
          return { data: n, error: null };
        }
        case "data_export_files_due": {
          const limit = (args as { _limit: number })._limit;
          const list = rows
            .filter(due)
            .sort((a, b) => (a.ready_at ?? 0) - (b.ready_at ?? 0))
            .slice(0, limit)
            .map((r) => ({ id: r.id, storage_path: r.storage_path }));
          return { data: list, error: null };
        }
        case "clear_data_export_files": {
          const ids = (args as { _ids: string[] })._ids;
          let n = 0;
          for (const r of rows) {
            if (ids.includes(r.id) && due(r)) {
              r.storage_path = null;
              n += 1;
            }
          }
          return { data: n, error: null };
        }
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    storage: {
      from: (name) => ({
        remove: async (paths) => {
          fake.buckets.push(name);
          fake.removes.push([...paths]);
          const call = fake.removes.length;
          if (opts.removeThrows?.(call)) throw new Error(`fetch failed for ${paths[0]}`);
          const error = opts.removeError?.(call);
          if (error) return { data: null, error };
          const data = paths.filter((p) => bucket.delete(p)).map((p) => ({ name: p }));
          return { data, error: null };
        },
      }),
    },
  };
  return fake;
}

const clockAt = () => {
  let t = 0;
  return { clock: () => t, advance: (ms: number) => (t += ms) };
};

describe("expireDataExports", () => {
  it("expires lapsed exports and deletes only their files, keeping every row", async () => {
    const fresh = exportRow("ready", 1);
    const almost = exportRow("ready", 23.9);
    const lapsedReady = exportRow("ready", 25);
    const oldExpired = exportRow("expired", 72);
    const failedOld = exportRow("failed", 30);
    const failedFresh = exportRow("failed", 2);
    const markedEarly = exportRow("expired", 1); // flipped early, window still open
    const alreadyCleared = exportRow("expired", 72, { file: false });
    const pointsAtFresh = exportRow("expired", 72, { path: fresh.storage_path! });
    const processing = exportRow("processing", null, { file: false });
    const fake = fakeBackend([
      fresh,
      almost,
      lapsedReady,
      oldExpired,
      failedOld,
      failedFresh,
      markedEarly,
      alreadyCleared,
      pointsAtFresh,
      processing,
    ]);
    const kept = [fresh, almost, failedFresh, markedEarly, pointsAtFresh].map(
      (r) => r.storage_path,
    );

    const summary = await expireDataExports(fake.admin);

    expect(summary).toEqual({
      ok: true,
      expired: 1,
      filesRemoved: 3,
      filesMissing: 0,
      pointersCleared: 3,
      batches: 1,
      more: false,
    });
    expect(fake.buckets).toEqual(["data-exports"]);
    expect(fake.removes.flat().sort()).toEqual(
      [oldExpired, failedOld, lapsedReady].map((r) => `${r.user_id}/${r.id}.json`).sort(),
    );
    for (const p of kept) {
      expect(fake.removes.flat()).not.toContain(p);
      expect(fake.bucket.has(p!)).toBe(true);
    }
    expect(fake.rows).toHaveLength(10);
    expect(fresh).toMatchObject({
      status: "ready",
      storage_path: `${fresh.user_id}/${fresh.id}.json`,
    });
    expect(lapsedReady).toMatchObject({ status: "expired", storage_path: null });
    expect(failedOld).toMatchObject({ status: "failed", storage_path: null });
    expect(pointsAtFresh.storage_path).toBe(fresh.storage_path);
    // expiry first, then list, remove, clear; a batch smaller than the batch size ends the run
    expect(fake.rpcs).toEqual([
      "expire_stale_data_exports",
      "data_export_files_due",
      "clear_data_export_files",
    ]);
  });

  it("removes in bounded batches, oldest first, and clears each batch after its files are gone", async () => {
    // row i was ready 100 + i hours ago, so the last row is the oldest
    const rows = Array.from({ length: 250 }, (_, i) => exportRow("expired", 100 + i));
    const paths = rows.map((r) => r.storage_path!);
    const fake = fakeBackend(rows);
    const summary = await expireDataExports(fake.admin);
    expect(fake.removes.map((b) => b.length)).toEqual([FILE_BATCH, FILE_BATCH, 50]);
    expect(fake.removes[0]).toEqual(paths.slice(150).reverse());
    expect(fake.removes[2]).toEqual(paths.slice(0, 50).reverse());
    expect(fake.removes.flat()).toHaveLength(250);
    expect(new Set(fake.removes.flat()).size).toBe(250);
    expect(summary).toMatchObject({
      ok: true,
      filesRemoved: 250,
      pointersCleared: 250,
      batches: 3,
      more: false,
    });
    expect(fake.bucket.size).toBe(0);
    expect(rows.every((r) => r.storage_path === null && r.status === "expired")).toBe(true);
  });

  it("an exact multiple of the batch ends with one empty listing", async () => {
    const fake = fakeBackend(Array.from({ length: 4 }, (_, i) => exportRow("expired", 30 + i)));
    const summary = await expireDataExports(fake.admin, { batch: 2 });
    expect(fake.removes.map((b) => b.length)).toEqual([2, 2]);
    expect(summary).toMatchObject({ ok: true, filesRemoved: 4, batches: 2, more: false });
    expect(fake.rpcs.filter((f) => f === "data_export_files_due")).toHaveLength(3);
  });

  it("stops at the batch cap and at the time budget, saying more may remain", async () => {
    const capped = fakeBackend(Array.from({ length: 30 }, (_, i) => exportRow("expired", 30 + i)));
    expect(await expireDataExports(capped.admin, { batch: 10, maxBatches: 2 })).toMatchObject({
      ok: true,
      filesRemoved: 20,
      batches: 2,
      more: true,
    });
    expect(capped.bucket.size).toBe(10);

    const timed = fakeBackend(Array.from({ length: 30 }, (_, i) => exportRow("expired", 30 + i)));
    const { clock, advance } = clockAt();
    const slow: ExpiryAdmin = {
      ...timed.admin,
      storage: {
        from: (b) => ({
          remove: async (paths) => {
            advance(2_000);
            return timed.admin.storage.from(b).remove(paths);
          },
        }),
      },
    };
    expect(await expireDataExports(slow, { batch: 10, clock, budgetMs: 3_000 })).toMatchObject({
      ok: true,
      filesRemoved: 20,
      batches: 2,
      more: true,
    });
    // the next run takes the rest
    expect(await expireDataExports(timed.admin, { batch: 10 })).toMatchObject({
      filesRemoved: 10,
      more: false,
    });
  });

  it("a failed removal keeps that batch's pointers, stops the run, and the next run retries them", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => exportRow("expired", 30 + i));
    let failing = true;
    const fake = fakeBackend(rows, {
      removeError: (call) => (failing && call === 2 ? { statusCode: "503", message: "x" } : null),
    });
    const first = await expireDataExports(fake.admin, { batch: 2 });
    expect(first).toEqual({
      ok: false,
      error: "remove_failed",
      expired: 0,
      filesRemoved: 2,
      filesMissing: 0,
      pointersCleared: 2,
      batches: 1,
      more: false,
    });
    expect(rows.filter((r) => r.storage_path !== null)).toHaveLength(3);
    expect(fake.removes).toHaveLength(2);

    failing = false;
    const second = await expireDataExports(fake.admin, { batch: 2 });
    expect(second).toMatchObject({ ok: true, filesRemoved: 3, pointersCleared: 3 });
    // the batch that failed is the first one tried again
    expect(fake.removes[2]).toEqual(fake.removes[1]);
    expect(rows.every((r) => r.storage_path === null)).toBe(true);
    expect(fake.bucket.size).toBe(0);
  });

  it("a removal that throws is handled the same way", async () => {
    const rows = [exportRow("expired", 30), exportRow("expired", 31)];
    const fake = fakeBackend(rows, { removeThrows: () => true });
    expect(await expireDataExports(fake.admin)).toMatchObject({
      ok: false,
      error: "remove_failed",
      pointersCleared: 0,
    });
    expect(rows.every((r) => r.storage_path !== null)).toBe(true);
    expect(fake.rpcs).not.toContain("clear_data_export_files");
  });

  it("a file already gone counts as missing and its pointer is cleared", async () => {
    const a = exportRow("expired", 30);
    const b = exportRow("expired", 31);
    const fake = fakeBackend([a, b], { missing: [a.storage_path!] });
    expect(await expireDataExports(fake.admin)).toMatchObject({
      ok: true,
      filesRemoved: 1,
      filesMissing: 1,
      pointersCleared: 2,
    });
    expect(a.storage_path).toBeNull();
  });

  it("a failed pointer clear stops the run; the next run finds the files gone and clears them", async () => {
    const rows = [exportRow("expired", 30), exportRow("expired", 31)];
    const broken = fakeBackend(rows, {
      rpcError: { clear_data_export_files: { code: "57014", message: "canceling statement" } },
    });
    expect(await expireDataExports(broken.admin)).toMatchObject({
      ok: false,
      error: "clear_failed",
      filesRemoved: 2,
      pointersCleared: 0,
      batches: 0,
    });
    expect(rows.every((r) => r.storage_path !== null)).toBe(true);

    const healthy = fakeBackend(rows, { missing: rows.map((r) => r.storage_path!) });
    expect(await expireDataExports(healthy.admin)).toMatchObject({
      ok: true,
      filesRemoved: 0,
      filesMissing: 2,
      pointersCleared: 2,
    });
  });

  it("a failed expiry or listing touches no file", async () => {
    const rows = [exportRow("expired", 30), exportRow("ready", 30)];
    const noExpire = fakeBackend(rows, {
      rpcError: { expire_stale_data_exports: { code: "42501", message: "permission denied" } },
    });
    expect(await expireDataExports(noExpire.admin)).toMatchObject({
      ok: false,
      error: "expire_failed",
    });
    expect(noExpire.removes).toHaveLength(0);
    expect(rows[1]!.status).toBe("ready");

    const noList = fakeBackend(rows, {
      rpcError: { data_export_files_due: { code: "PGRST202", message: "not found" } },
    });
    expect(await expireDataExports(noList.admin)).toMatchObject({
      ok: false,
      error: "list_failed",
      expired: 1,
    });
    expect(noList.removes).toHaveLength(0);

    // an answer that is not a list of rows is refused, not guessed at
    const odd = fakeBackend(rows);
    const oddAdmin: ExpiryAdmin = {
      ...odd.admin,
      rpc: async (fn, args) =>
        fn === "data_export_files_due"
          ? { data: [{ id: rows[0]!.id, storage_path: "" }], error: null }
          : odd.admin.rpc(fn, args),
    };
    expect(await expireDataExports(oddAdmin)).toMatchObject({ ok: false, error: "list_failed" });
    expect(odd.removes).toHaveLength(0);
  });
});

describe("no file names, user ids or export ids in logs or reports", () => {
  const logs: string[] = [];
  beforeEach(() => {
    logs.length = 0;
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
  });
  afterEach(() => vi.restoreAllMocks());

  it("on success and on every kind of failure", async () => {
    const rows = [exportRow("expired", 30), exportRow("ready", 26), exportRow("failed", 40)];
    const secrets = rows.flatMap((r) => [r.id, r.user_id, `${r.user_id}/${r.id}.json`]);
    const leaky = (stage: string) => ({
      code: "23514",
      message: `Failing row contains (${rows[0]!.id}, ${rows[0]!.user_id}, ${rows[0]!.storage_path}) in ${stage}`,
    });
    const outputs = [
      await expireDataExports(fakeBackend(structuredClone(rows)).admin),
      await expireDataExports(
        fakeBackend(structuredClone(rows), {
          rpcError: { expire_stale_data_exports: leaky("expire") },
        }).admin,
      ),
      await expireDataExports(
        fakeBackend(structuredClone(rows), { rpcError: { data_export_files_due: leaky("list") } })
          .admin,
      ),
      await expireDataExports(
        fakeBackend(structuredClone(rows), {
          rpcError: { clear_data_export_files: leaky("clear") },
        }).admin,
      ),
      await expireDataExports(
        fakeBackend(structuredClone(rows), { removeError: () => leaky("remove") }).admin,
      ),
      await expireDataExports(
        fakeBackend(structuredClone(rows), { removeThrows: () => true }).admin,
      ),
    ];
    expect(outputs.map((o) => o.error ?? "ok")).toEqual([
      "ok",
      "expire_failed",
      "list_failed",
      "clear_failed",
      "remove_failed",
      "remove_failed",
    ]);
    expect(logs.length).toBeGreaterThan(0);
    const text = JSON.stringify(outputs) + "\n" + logs.join("\n");
    for (const s of secrets) expect(text).not.toContain(s);
    expect(text).not.toContain("Failing row");
    for (const o of outputs) {
      for (const [k, v] of Object.entries(o)) {
        if (k === "error") expect(v).toMatch(/^(expire|list|remove|clear)_failed$/);
        else expect(typeof v === "number" || typeof v === "boolean").toBe(true);
      }
    }
  });
});

describe("POST /api/public/data-exports/expire", () => {
  type Handler = (ctx: { request: Request }) => Promise<Response>;
  const POST = (Route as unknown as { options: { server: { handlers: { POST: Handler } } } })
    .options.server.handlers.POST;
  const call = (headers: Record<string, string> = {}) =>
    POST({
      request: new Request("https://app.test/api/public/data-exports/expire", {
        method: "POST",
        headers,
      }),
    });

  beforeEach(() => {
    process.env.REELS_WORKER_SECRET = "worker-secret-987";
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.REELS_WORKER_SECRET;
    vi.restoreAllMocks();
  });

  it("needs the worker secret: no secret or a wrong one is refused before anything runs", async () => {
    const lapsedRow = exportRow("expired", 30);
    const fake = fakeBackend([lapsedRow]);
    shared.admin = fake.admin;
    const attempts: Record<string, string>[] = [
      {},
      { "x-worker-secret": "nope" },
      { authorization: "Bearer nope" },
    ];
    for (const headers of attempts) {
      const res = await call(headers);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
    expect(fake.rpcs.filter((f) => f !== "check_worker_secret")).toEqual([]);
    expect(fake.removes).toHaveLength(0);
    expect(lapsedRow.storage_path).not.toBeNull();
  });

  it("with the secret it runs and answers counts", async () => {
    const lapsedRow = exportRow("ready", 30);
    const fresh = exportRow("ready", 1);
    const fake = fakeBackend([lapsedRow, fresh]);
    shared.admin = fake.admin;
    const res = await call({ "x-worker-secret": "worker-secret-987" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      expired: 1,
      filesRemoved: 1,
      filesMissing: 0,
      pointersCleared: 1,
      batches: 1,
      more: false,
    });
    expect(fresh.storage_path).not.toBeNull();
    expect(JSON.stringify(body)).not.toContain(lapsedRow.id);
  });

  it("a failed stage answers 500 with the counts so far", async () => {
    const fake = fakeBackend([exportRow("expired", 30)], {
      removeError: () => ({ statusCode: "500" }),
    });
    shared.admin = fake.admin;
    const res = await call({ authorization: "Bearer worker-secret-987" });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "remove_failed",
      pointersCleared: 0,
    });
  });
});
