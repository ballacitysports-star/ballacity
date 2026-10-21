/**
 * A tiny in-memory stand-in for the Supabase query builder, covering only the
 * calls the discovery code makes (select / insert / update / upsert with
 * eq, in, gte, or, order, limit, range, single, maybeSingle). Tests use it to
 * run the engine and review logic against real row state without a database.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

/** Column defaults, mirroring the migration, applied to every inserted row. */
const DEFAULTS: Record<string, () => Row> = {
  listing_discovery_runs: () => ({
    status: "running",
    tasks: [],
    pages: [],
    seen_hosts: [],
    max_pages: 80,
    pages_done: 0,
    stats: {},
    log: [],
    error: null,
    lock_until: null,
    updated_at: new Date().toISOString(),
    finished_at: null,
  }),
  listing_discovery_pages: () => ({ candidates: 0, fetched_at: new Date().toISOString() }),
  listing_candidates: () => ({
    status: "pending",
    sports: [],
    duplicate_of: null,
    reject_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    created_listing_id: null,
  }),
};

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

/** Evaluates one `col.op.value` term of a PostgREST `or(...)` string. */
function orTerm(term: string): Filter {
  const [col, op, ...rest] = term.split(".");
  const value = rest.join(".");
  return (row) => {
    const v = row[col];
    if (op === "is" && value === "null") return v === null || v === undefined;
    if (op === "lt") return v != null && String(v) < value;
    if (op === "gte") return v != null && String(v) >= value;
    if (op === "eq") return String(v) === value;
    if (op === "ilike") {
      const needle = value.replace(/^%|%$/g, "").toLowerCase();
      return v != null && String(v).toLowerCase().includes(needle);
    }
    return false;
  };
}

class Query implements PromiseLike<{
  data: unknown;
  error: null | { message: string };
  count: number | null;
}> {
  private filters: Filter[] = [];
  private mode: "select" | "insert" | "update" | "upsert" = "select";
  private payload: Row | Row[] = [];
  private options: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private wantsRows = false;
  private head = false;
  private orderBy: { col: string; asc: boolean }[] = [];
  private from = 0;
  private to = Infinity;
  private one: "single" | "maybe" | null = null;
  private failure: string | null = null;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    this.wantsRows = true;
    this.head = opts?.head === true;
    return this;
  }
  insert(row: Row | Row[]) {
    this.mode = "insert";
    this.payload = row;
    return this;
  }
  update(patch: Row) {
    this.mode = "update";
    this.payload = patch;
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.mode = "upsert";
    this.payload = rows;
    this.options = opts;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  gte(col: string, val: unknown) {
    this.filters.push((r) => r[col] != null && String(r[col]) >= String(val));
    return this;
  }
  or(expr: string) {
    const terms = expr.split(",").map(orTerm);
    this.filters.push((r) => terms.some((t) => t(r)));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy.push({ col, asc: opts.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.to = Math.min(this.to, this.from + n - 1);
    return this;
  }
  range(from: number, to: number) {
    this.from = from;
    this.to = to;
    return this;
  }
  single() {
    this.one = "single";
    return this;
  }
  maybeSingle() {
    this.one = "maybe";
    return this;
  }

  private defaults(): Row {
    return DEFAULTS[this.table]?.() ?? {};
  }

  private match(rows: Row[]) {
    return rows.filter((r) => this.filters.every((f) => f(r)));
  }

  private run() {
    const rows = this.db.rows(this.table);
    let affected: Row[] = [];
    if (this.mode === "insert") {
      for (const p of [this.payload].flat()) {
        const row = { id: newId(), created_at: new Date().toISOString(), ...this.defaults(), ...p };
        rows.push(row);
        affected.push(row);
      }
    } else if (this.mode === "update") {
      affected = this.match(rows);
      for (const r of affected) Object.assign(r, this.payload);
    } else if (this.mode === "upsert") {
      const keys = (this.options.onConflict ?? "id").split(",");
      for (const p of [this.payload].flat()) {
        const existing = rows.find((r) => keys.every((k) => r[k] === p[k]));
        if (existing) {
          if (!this.options.ignoreDuplicates) {
            Object.assign(existing, p);
            affected.push(existing);
          }
        } else {
          const row = {
            id: newId(),
            created_at: new Date().toISOString(),
            ...this.defaults(),
            ...p,
          };
          rows.push(row);
          affected.push(row);
        }
      }
    } else {
      affected = this.match(rows);
    }

    if (this.mode === "select") {
      for (const o of [...this.orderBy].reverse()) {
        affected = [...affected].sort((a, b) => {
          const x = a[o.col] as never;
          const y = b[o.col] as never;
          return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
        });
      }
    }
    const total = affected.length;
    const page = this.mode === "select" ? affected.slice(this.from, this.to + 1) : affected;
    const copy = (r: Row) => structuredClone(r);

    if (this.failure) return { data: null, error: { message: this.failure }, count: null };
    if (this.head) return { data: null, error: null, count: total };
    if (this.one) {
      const first = page[0];
      if (!first && this.one === "single") {
        return { data: null, error: { message: "no rows" }, count: null };
      }
      return { data: first ? copy(first) : null, error: null, count: total };
    }
    return {
      data: this.wantsRows || this.mode === "select" ? page.map(copy) : null,
      error: null,
      count: total,
    };
  }

  then<R1, R2>(
    onfulfilled?: ((v: ReturnType<Query["run"]>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ) {
    try {
      return Promise.resolve(this.run()).then(onfulfilled, onrejected);
    } catch (e) {
      return Promise.reject(e).then(onfulfilled, onrejected);
    }
  }
}

export class FakeDb {
  private data: Record<string, Row[]> = {};
  constructor(seed: Record<string, Row[]> = {}) {
    for (const [t, rows] of Object.entries(seed)) this.data[t] = structuredClone(rows);
  }
  rows(table: string): Row[] {
    return (this.data[table] ??= []);
  }
  from(table: string) {
    return new Query(this, table);
  }
}
