/**
 * P3-6a: a member's data export expires 24 hours after it is ready (docs/data-retention.md), and then its file is
 * deleted. The daily `expire-data-exports` job (migration 20261205110000) calls the worker route
 * `/api/public/data-exports/expire`, which runs this with the service role:
 *
 *   1. `expire_stale_data_exports()` flips every export whose window has ended to `expired`.
 *   2. `data_export_files_due(batch)` returns a batch of expired exports that still point at a file. The database decides
 *      which: only lapsed rows, never a `ready` one, and only a file named after that export (`<user_id>/<id>.json`), so
 *      this never deletes a file of an export that has not expired.
 *   3. Those files are removed from the private `data-exports` bucket in one call, then
 *      `clear_data_export_files(ids)` clears the rows' file pointers so they are not tried again. The rows are kept (the
 *      member's history, and the daily rate limit counts them).
 *
 * A batch whose removal fails keeps its pointers, and the run stops there: the next run tries the same files again. A
 * file that is already gone counts as missing and its pointer is cleared. pg_net stops waiting for the call after 5
 * seconds and the Worker is then cancelled, so a run starts no new batch after RUN_BUDGET_MS and at most MAX_BATCHES
 * batches; `more` says rows may remain for the next run.
 *
 * The summary and the log lines carry counts and a stage name only: never a file name, a user id or an export id, and
 * not the database's or the storage API's error text (which can quote row values).
 */
import { EXPORT_BUCKET } from "@/lib/data-export";

/** Files per storage call and per database batch (the storage API takes at most 1000 names per call). */
export const FILE_BATCH = 100;
/** Batches one run takes on. */
export const MAX_BATCHES = 10;
/** A run starts no new batch once it has taken this long. */
export const RUN_BUDGET_MS = 3_000;

type DbError = { code?: string | null } | null;
type RpcResult = { data: unknown; error: DbError };

// The service-role client, narrowed to what this file calls.
export type ExpiryAdmin = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
  storage: {
    from: (bucket: string) => {
      remove: (paths: string[]) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
    };
  };
};

export type ExpiryStage = "expire" | "list" | "remove" | "clear";

export type ExpirySummary = {
  ok: boolean;
  /** Exports flipped to expired by this run. */
  expired: number;
  /** Files the storage API deleted. */
  filesRemoved: number;
  /** Files that were already gone when their batch was removed (their pointers are cleared too). */
  filesMissing: number;
  /** Rows whose file pointer this run cleared. */
  pointersCleared: number;
  /** Batches removed and cleared. */
  batches: number;
  /** Rows with a file may remain: the run stopped at its time budget or batch cap. */
  more: boolean;
  /** The stage that failed; the run stopped there. */
  error?: `${ExpiryStage}_failed`;
};

function codeOf(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { code?: unknown; status?: unknown; statusCode?: unknown };
    for (const v of [e.code, e.statusCode, e.status]) {
      if (typeof v === "string" && /^[A-Za-z0-9_]{1,16}$/.test(v)) return v;
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
  }
  return "unknown";
}

type DueRow = { id: string; storage_path: string };

function dueRows(data: unknown): DueRow[] | null {
  if (!Array.isArray(data)) return null;
  const rows: DueRow[] = [];
  for (const r of data) {
    const row = r as { id?: unknown; storage_path?: unknown } | null;
    if (
      !row ||
      typeof row.id !== "string" ||
      typeof row.storage_path !== "string" ||
      !row.storage_path
    ) {
      return null;
    }
    rows.push({ id: row.id, storage_path: row.storage_path });
  }
  return rows;
}

export async function expireDataExports(
  admin: ExpiryAdmin,
  opts: { clock?: () => number; budgetMs?: number; batch?: number; maxBatches?: number } = {},
): Promise<ExpirySummary> {
  const clock = opts.clock ?? Date.now;
  const startedAt = clock();
  const budget = opts.budgetMs ?? RUN_BUDGET_MS;
  const batch = Math.min(Math.max(1, opts.batch ?? FILE_BATCH), 1000);
  const maxBatches = Math.max(1, opts.maxBatches ?? MAX_BATCHES);
  const summary: ExpirySummary = {
    ok: true,
    expired: 0,
    filesRemoved: 0,
    filesMissing: 0,
    pointersCleared: 0,
    batches: 0,
    more: false,
  };
  const fail = (stage: ExpiryStage, error: unknown): ExpirySummary => {
    console.warn(
      `[data-export-expiry] ${stage} failed (${codeOf(error)}); the next run tries again`,
    );
    return { ...summary, ok: false, error: `${stage}_failed` };
  };

  try {
    const { data, error } = await admin.rpc("expire_stale_data_exports");
    if (error) return fail("expire", error);
    summary.expired = typeof data === "number" ? data : 0;
  } catch (e) {
    return fail("expire", e);
  }

  for (;;) {
    if (summary.batches >= maxBatches || clock() - startedAt >= budget) {
      summary.more = true;
      break;
    }

    let rows: DueRow[] | null;
    try {
      const { data, error } = await admin.rpc("data_export_files_due", { _limit: batch });
      if (error) return fail("list", error);
      rows = dueRows(data);
      if (!rows) return fail("list", null);
    } catch (e) {
      return fail("list", e);
    }
    if (rows.length === 0) break;

    const paths = rows.map((r) => r.storage_path);
    try {
      const { data, error } = await admin.storage.from(EXPORT_BUCKET).remove(paths);
      if (error) return fail("remove", error);
      const removed = Array.isArray(data) ? Math.min(data.length, paths.length) : 0;
      summary.filesRemoved += removed;
      summary.filesMissing += paths.length - removed;
    } catch (e) {
      return fail("remove", e);
    }

    try {
      const { data, error } = await admin.rpc("clear_data_export_files", {
        _ids: rows.map((r) => r.id),
      });
      if (error) return fail("clear", error);
      summary.pointersCleared += typeof data === "number" ? data : 0;
    } catch (e) {
      return fail("clear", e);
    }
    summary.batches += 1;

    if (rows.length < batch) break;
  }
  return summary;
}
