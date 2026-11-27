import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * requestDataExport: a build that fails after its file may be in the private bucket deletes that file. The expiry job
 * (migration 20261205110000) finds a file only through the row's storage_path, which only the "ready" update writes, so
 * a file left behind by a failed build would stay in the bucket for good.
 */

// A server function is its handler for these tests: validate the input, then run it with the context the auth
// middleware would have given it.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (d: unknown) => d;
    const b = {
      middleware() {
        return b;
      },
      inputValidator(fn: (d: unknown) => unknown) {
        validate = fn;
        return b;
      },
      handler(fn: (ctx: { data: unknown; context: unknown }) => unknown) {
        return async (arg: { data?: unknown; context?: unknown } = {}) =>
          fn({ data: validate(arg.data), context: arg.context });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

type Err = { message: string } | null;

const db = vi.hoisted(() => ({
  /** What the service-role client and the bucket were asked to do, in order. */
  log: [] as string[],
  updates: [] as Record<string, unknown>[],
  removes: [] as { bucket: string; paths: string[] }[],
  notifications: [] as Record<string, unknown>[],
  readyError: null as { message: string } | null,
  uploadError: null as { message: string } | null,
  removeThrows: false,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          db.log.push(`update ${table} ${String(patch.status)}`);
          db.updates.push(patch);
          return { data: null, error: patch.status === "ready" ? db.readyError : null };
        },
      }),
      insert: async (row: Record<string, unknown>) => {
        db.log.push(`insert ${table} ${String(row.type)}`);
        if (table === "notifications") db.notifications.push(row);
        return { data: null, error: null };
      },
    }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          db.log.push(`upload ${bucket} ${path}`);
          return { data: db.uploadError ? null : { path }, error: db.uploadError };
        },
        remove: async (paths: string[]) => {
          db.log.push(`remove ${bucket} ${paths.join(",")}`);
          db.removes.push({ bucket, paths });
          if (db.removeThrows) throw new Error("fetch failed");
          return { data: paths.map((name) => ({ name })), error: null };
        },
      }),
    },
  },
}));

import { requestDataExport } from "./data-export.functions";
import { EXPORT_TTL_HOURS } from "./data-export";

const USER = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const FILE = `${USER}/${REQUEST}.json`;

/** The member's own client: the request insert, then the category reads. */
function memberClient(readError: Err = null) {
  return {
    from: () => ({
      insert: () => ({
        select: () => ({ single: async () => ({ data: { id: REQUEST }, error: null }) }),
      }),
      select: () => ({ eq: async () => ({ data: [], error: readError }) }),
    }),
  };
}

const run = (readError: Err = null) =>
  requestDataExport({
    data: { categories: ["profile"] },
    context: { supabase: memberClient(readError), userId: USER },
  } as never) as Promise<{ id: string; status: string; error?: string }>;

beforeEach(() => {
  db.log = [];
  db.updates = [];
  db.removes = [];
  db.notifications = [];
  db.readyError = null;
  db.uploadError = null;
  db.removeThrows = false;
});

describe("requestDataExport", () => {
  it("stores the file at <user_id>/<id>.json, marks it ready with its window, and removes nothing", async () => {
    const result = await run();
    expect(result).toEqual({ id: REQUEST, status: "ready" });
    expect(db.log).toEqual([
      "update data_export_requests processing",
      `upload data-exports ${FILE}`,
      "update data_export_requests ready",
      "insert notifications data_export_ready",
    ]);
    const ready = db.updates.find((u) => u.status === "ready")!;
    expect(ready.storage_path).toBe(FILE);
    expect(Date.parse(String(ready.expires_at)) - Date.parse(String(ready.ready_at))).toBe(
      EXPORT_TTL_HOURS * 3600 * 1000,
    );
    expect(db.removes).toEqual([]);
  });

  it("when marking it ready fails, deletes the file first and marks the export failed, not ready", async () => {
    db.readyError = { message: "could not update" };
    const result = await run();
    expect(result).toMatchObject({ id: REQUEST, status: "failed" });
    expect(db.log).toEqual([
      "update data_export_requests processing",
      `upload data-exports ${FILE}`,
      "update data_export_requests ready",
      `remove data-exports ${FILE}`,
      "update data_export_requests failed",
      "insert notifications data_export_failed",
    ]);
    expect(db.removes).toEqual([{ bucket: "data-exports", paths: [FILE] }]);
    expect(db.notifications.map((n) => n.type)).toEqual(["data_export_failed"]);
  });

  it("when the upload reports an error, deletes the file it may have stored anyway", async () => {
    db.uploadError = { message: "gateway timeout" };
    const result = await run();
    expect(result).toMatchObject({ id: REQUEST, status: "failed" });
    expect(db.removes).toEqual([{ bucket: "data-exports", paths: [FILE] }]);
    expect(db.log.slice(-2)).toEqual([
      "update data_export_requests failed",
      "insert notifications data_export_failed",
    ]);
    expect(db.updates.some((u) => u.status === "ready")).toBe(false);
  });

  it("a read that fails before anything is stored deletes nothing", async () => {
    const result = await run({ message: "permission denied" });
    expect(result).toMatchObject({ id: REQUEST, status: "failed" });
    expect(db.log.some((l) => l.startsWith("upload"))).toBe(false);
    expect(db.removes).toEqual([]);
  });

  it("a delete that throws still marks the export failed", async () => {
    db.readyError = { message: "could not update" };
    db.removeThrows = true;
    const result = await run();
    expect(result).toMatchObject({ id: REQUEST, status: "failed" });
    expect(db.removes).toHaveLength(1);
    expect(db.log.slice(-2)).toEqual([
      "update data_export_requests failed",
      "insert notifications data_export_failed",
    ]);
  });
});
