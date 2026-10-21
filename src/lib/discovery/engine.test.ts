import { describe, expect, it, vi } from "vitest";
import { FakeDb } from "./fake-db";
import {
  PAGES_PER_STEP,
  STEP_BUDGET_MS,
  TASKS_PER_STEP,
  cancelRun,
  startRun,
  stepRun,
  type DiscoveryDeps,
} from "./engine.server";
import { osmTasks, searchTasks, areaById } from "./areas";
import type { Extraction, CleanOrg } from "./extract";

const T0 = Date.parse("2026-10-21T12:00:00Z");
const USER = "00000000-0000-4000-8000-0000000000aa";
const atlanta = areaById("atlanta")!;

const page = { title: "t", description: "", jsonLd: [], text: "readable text ".repeat(40) };

function org(over: Partial<CleanOrg> = {}): CleanOrg {
  return {
    type: "gym",
    name: "Peach State Hoops",
    city: "Atlanta",
    state: "GA",
    address: "12 Court St",
    website: "https://peachhoops.com",
    sports: ["Basketball"],
    category: "Indoor courts",
    description: null,
    confidence: 0.9,
    ...over,
  };
}
const orgPage = (...orgs: CleanOrg[]): Extraction => ({
  pageKind: "organization",
  orgs,
  dropped: [],
});

function makeDeps(over: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  return {
    now: () => T0,
    searchEnabled: true,
    searchWeb: vi.fn(async () => []),
    osmLeads: vi.fn(async () => []),
    fetchPage: vi.fn(async (url: string) => ({ ok: true as const, url, page })),
    extract: vi.fn(async () => orgPage(org())),
    isFatalError: (m: string) => m === "fatal",
    ...over,
  };
}

/** A run with no lookups left and the given pages queued. */
async function runWithPages(
  db: FakeDb,
  urls: string[],
  opts: { types?: string[]; maxPages?: number } = {},
) {
  const run = await startRun(db, makeDeps(), {
    userId: USER,
    areaId: "atlanta",
    types: opts.types ?? ["gym", "team", "coach"],
    maxPages: opts.maxPages,
  });
  const row = db.rows("listing_discovery_runs")[0];
  row.tasks = [];
  row.pages = urls.map((url) => ({ url, source: "search", depth: 0 }));
  return run.id;
}

const candidates = (db: FakeDb) => db.rows("listing_candidates");

describe("startRun", () => {
  it("plans a map lookup and a set of searches for every requested type", async () => {
    const db = new FakeDb();
    const run = await startRun(db, makeDeps(), {
      userId: USER,
      areaId: "atlanta",
      types: ["gym", "team", "coach"],
    });
    const types = ["gym", "team", "coach"] as const;
    expect(run.tasksLeft).toBe(osmTasks(types).length + searchTasks(atlanta, types).length);
    expect(run.status).toBe("running");
    expect(run.maxPages).toBe(80);
  });

  it("falls back to the map alone when web search is not configured", async () => {
    const db = new FakeDb();
    const run = await startRun(db, makeDeps({ searchEnabled: false }), {
      userId: USER,
      areaId: "atlanta",
      types: ["gym", "team"],
    });
    expect(run.tasksLeft).toBe(2);
    expect(run.log.join(" ")).toMatch(/Web search is off/);
  });

  it("allows one run at a time, and replaces one that stopped making progress", async () => {
    const db = new FakeDb();
    await startRun(db, makeDeps(), { userId: USER, areaId: "atlanta", types: ["gym"] });
    await expect(
      startRun(db, makeDeps(), { userId: USER, areaId: "atlanta", types: ["gym"] }),
    ).rejects.toThrow(/already in progress/);
    // The database stamps rows with the real clock; pin it to the test's.
    db.rows("listing_discovery_runs")[0].updated_at = new Date(T0).toISOString();

    const later = makeDeps({ now: () => T0 + 2 * 3_600_000 });
    await startRun(db, later, { userId: USER, areaId: "atlanta", types: ["gym"] });
    expect(db.rows("listing_discovery_runs").map((r) => r.status)).toEqual(["failed", "running"]);
  });

  it("rejects an unknown area, no types, and clamps the page limit", async () => {
    const db = new FakeDb();
    await expect(
      startRun(db, makeDeps(), { userId: USER, areaId: "mars", types: ["gym"] }),
    ).rejects.toThrow(/Unknown area/);
    await expect(
      startRun(db, makeDeps(), { userId: USER, areaId: "atlanta", types: ["referee"] }),
    ).rejects.toThrow(/at least one type/);
    const run = await startRun(db, makeDeps(), {
      userId: USER,
      areaId: "atlanta",
      types: ["gym"],
      maxPages: 9999,
    });
    expect(run.maxPages).toBe(200);
  });
});

describe("stepRun: lookups", () => {
  it("turns search and map results into a de-duplicated queue of sites to read", async () => {
    const db = new FakeDb({
      listing_discovery_pages: [
        {
          url: "https://old.com/",
          host: "old.com",
          outcome: "ok",
          fetched_at: new Date(T0 - 86_400_000).toISOString(),
        },
        {
          url: "https://err.com/",
          host: "err.com",
          outcome: "error",
          fetched_at: new Date(T0 - 86_400_000).toISOString(),
        },
      ],
    });
    const run = await startRun(db, makeDeps(), { userId: USER, areaId: "atlanta", types: ["gym"] });
    const deps = makeDeps({
      osmLeads: vi.fn(async () => [
        { ref: "way/1", website: "https://a.com", hintName: "A Court", hintSport: "basketball" },
        { ref: "way/2", website: "facebook.com/somegym", hintName: null, hintSport: null },
        { ref: "way/3", website: "not a url", hintName: null, hintSport: null },
      ]),
      searchWeb: vi.fn(async () => [
        { url: "https://www.a.com/programs" }, // same site as the map lead
        { url: "https://old.com/" }, // read recently
        { url: "https://err.com/x" }, // failed last time, so try again
        { url: "https://b.com/" },
        { url: "https://yelp.com/biz/x" },
      ]),
    });

    const after = await stepRun(db, deps, { runId: run.id, userId: USER });
    expect(deps.osmLeads).toHaveBeenCalledTimes(1);
    expect(deps.searchWeb).toHaveBeenCalledTimes(TASKS_PER_STEP - 1);
    const queued = (
      db.rows("listing_discovery_runs")[0].pages as { url: string; hint?: unknown }[]
    ).map((p) => p.url);
    expect(queued).toEqual(["https://a.com/", "https://err.com/x", "https://b.com/"]);
    expect(after.pagesLeft).toBe(3);
    expect(after.tasksLeft).toBe(run.tasksLeft - TASKS_PER_STEP);
    expect(after.status).toBe("running");
    expect(db.rows("listing_discovery_runs")[0].lock_until).toBeNull();
  });

  it("records a failed lookup and carries on", async () => {
    const db = new FakeDb();
    const run = await startRun(db, makeDeps(), { userId: USER, areaId: "atlanta", types: ["gym"] });
    const deps = makeDeps({
      osmLeads: vi.fn(async () => {
        throw new Error("OpenStreetMap lookup failed (HTTP 429).");
      }),
      searchWeb: vi.fn(async () => [{ url: "https://c.com" }]),
    });
    const after = await stepRun(db, deps, { runId: run.id, userId: USER });
    expect(after.stats.errors).toBe(1);
    expect(after.log.join(" ")).toMatch(/Map lookup failed: OpenStreetMap lookup failed/);
    expect(after.pagesLeft).toBe(1);
  });
});

describe("stepRun: reading pages", () => {
  it("saves what a page describes as a candidate that waits for a person", async () => {
    const db = new FakeDb();
    const id = await runWithPages(db, ["https://peachhoops.com/about"]);
    const out = await stepRun(db, makeDeps(), { runId: id, userId: USER });

    expect(candidates(db)).toHaveLength(1);
    expect(candidates(db)[0]).toMatchObject({
      subject_type: "gym",
      name: "Peach State Hoops",
      city: "Atlanta",
      state: "GA",
      source: "search",
      source_url: "https://peachhoops.com/about",
      status: "pending",
      confidence: 0.9,
      duplicate_of: null,
      reject_reason: null,
    });
    expect(out.stats).toMatchObject({ pagesRead: 1, candidates: 1, aiCalls: 1 });
    expect(db.rows("listing_discovery_pages")[0]).toMatchObject({
      host: "peachhoops.com",
      outcome: "ok",
      candidates: 1,
    });
    expect(out.status).toBe("done"); // nothing left to do
  });

  it("does not list an organization we already list, but remembers it", async () => {
    const db = new FakeDb({
      trainer_orgs: [{ id: "g1", name: "Peach State Hoops LLC", city: "Atlanta", website: null }],
    });
    const id = await runWithPages(db, ["https://peachhoops.com/"]);
    const out = await stepRun(db, makeDeps(), { runId: id, userId: USER });
    expect(candidates(db)).toHaveLength(1);
    expect(candidates(db)[0]).toMatchObject({
      status: "rejected",
      reject_reason: "Already listed: Peach State Hoops LLC",
    });
    expect(out.stats.candidates).toBe(0);
    expect(out.stats.duplicates).toBe(1);
  });

  it("matches trainers against trainers and teams against teams", async () => {
    const db = new FakeDb({
      teams: [
        { id: "t1", name: "Coach Dre Training", city: "Atlanta", kind: "team" },
        { id: "t2", name: "Atlanta Elite Basketball", city: "Atlanta", kind: "coach" },
      ],
    });
    const id = await runWithPages(db, ["https://dre.com/", "https://elite.com/"]);
    const extract = vi
      .fn()
      .mockResolvedValueOnce(
        orgPage(
          org({
            type: "coach",
            name: "Coach Dre Training",
            address: null,
            website: "https://dre.com",
          }),
        ),
      )
      .mockResolvedValueOnce(
        orgPage(
          org({
            type: "team",
            name: "Atlanta Elite Basketball",
            address: null,
            website: "https://elite.com",
          }),
        ),
      );
    await stepRun(db, makeDeps({ extract }), { runId: id, userId: USER });
    // Same names, but in the other kind of listing, so neither counts as already listed.
    expect(candidates(db).map((c) => c.status)).toEqual(["pending", "pending"]);
  });

  it("warns about a likely repeat instead of hiding it", async () => {
    const db = new FakeDb({
      trainer_orgs: [
        { id: "g1", name: "Peach State Hoops Academy", city: "Atlanta", website: null },
      ],
    });
    const id = await runWithPages(db, ["https://peachhoops.com/"]);
    await stepRun(db, makeDeps(), { runId: id, userId: USER });
    const c = candidates(db)[0];
    expect(c.status).toBe("pending");
    expect(c.duplicate_of).toMatchObject({
      kind: "gym",
      id: "g1",
      name: "Peach State Hoops Academy",
    });
  });

  it("finds an organization once even when two pages describe it", async () => {
    const db = new FakeDb();
    const id = await runWithPages(db, ["https://a.com/", "https://b.com/"]);
    const out = await stepRun(db, makeDeps(), { runId: id, userId: USER });
    expect(candidates(db)).toHaveLength(1);
    expect(out.stats).toMatchObject({ candidates: 1, duplicates: 1 });
  });

  it("keeps a rejected find rejected when a later run finds it again", async () => {
    const db = new FakeDb();
    const first = await runWithPages(db, ["https://a.com/"]);
    await stepRun(db, makeDeps(), { runId: first, userId: USER });
    candidates(db)[0].status = "rejected";

    db.rows("listing_discovery_runs")[0].status = "done";
    const again = await runWithPages(db, ["https://other-site.com/"]);
    db.rows("listing_discovery_runs")[1].tasks = [];
    await stepRun(db, makeDeps(), { runId: again, userId: USER });
    expect(candidates(db)).toHaveLength(1);
    expect(candidates(db)[0].status).toBe("rejected");
  });

  it("follows a directory page to each listed site once, and no deeper", async () => {
    const db = new FakeDb();
    const id = await runWithPages(db, ["https://guide.com/best-gyms"]);
    const directory = (...sites: [string, string][]): Extraction => ({
      pageKind: "directory",
      orgs: sites.map(([name, website]) => org({ name, website })),
      dropped: [],
    });
    const extract = vi
      .fn()
      // The guide lists two sites…
      .mockResolvedValueOnce(directory(["One", "https://one.com"], ["Two", "https://two.com"]))
      // …and the first of them is itself a directory pointing at a third.
      .mockResolvedValueOnce(directory(["Three", "https://three.com"]));
    const out = await stepRun(db, makeDeps({ extract }), { runId: id, userId: USER });

    expect(candidates(db)).toHaveLength(0); // nothing is taken from a directory itself
    const queued = db.rows("listing_discovery_runs")[0].pages as {
      url: string;
      depth: number;
      hint: { name: string };
    }[];
    // One was read this step; Two is still waiting; Three was never queued.
    expect(queued.map((p) => [p.url, p.depth, p.hint.name])).toEqual([
      ["https://two.com/", 1, "Two"],
    ]);
    expect(out.stats.leads).toBe(2);
    expect(out.status).toBe("running");
  });

  it("skips pages it may not or cannot read, retrying only real failures later", async () => {
    const db = new FakeDb();
    const id = await runWithPages(db, ["https://closed.com/", "https://down.com/"]);
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "blocked by robots.txt" })
      .mockResolvedValueOnce({ ok: false, reason: "HTTP 503" });
    const out = await stepRun(db, makeDeps({ fetchPage }), { runId: id, userId: USER });
    expect(out.stats.pagesSkipped).toBe(2);
    expect(out.log.join(" ")).toMatch(/closed.com: skipped \(blocked by robots.txt\)/);
    expect(db.rows("listing_discovery_pages").map((p) => [p.host, p.outcome])).toEqual([
      ["closed.com", "skipped"],
      ["down.com", "error"],
    ]);
  });

  it("stops at the page limit and says so", async () => {
    const db = new FakeDb();
    const id = await runWithPages(db, ["https://a.com/", "https://b.com/", "https://c.com/"], {
      maxPages: 1,
    });
    const out = await stepRun(db, makeDeps({ extract: vi.fn(async () => orgPage(org())) }), {
      runId: id,
      userId: USER,
    });
    expect(out.status).toBe("done");
    expect(out.pagesDone).toBe(1);
    expect(out.pagesLeft).toBe(0);
    expect(out.log.join(" ")).toMatch(/Stopped at the page limit/);
  });

  it("reads at most a couple of pages per step, and stops early when the step runs long", async () => {
    const db = new FakeDb();
    const urls = ["https://a.com/", "https://b.com/", "https://c.com/", "https://d.com/"];
    const id = await runWithPages(db, urls);
    const out = await stepRun(db, makeDeps(), { runId: id, userId: USER });
    expect(out.pagesDone).toBe(PAGES_PER_STEP);
    expect(out.status).toBe("running");

    const db2 = new FakeDb();
    const id2 = await runWithPages(db2, urls);
    let t = T0;
    const slow = makeDeps({ now: () => (t += STEP_BUDGET_MS * 0.6) });
    const out2 = await stepRun(db2, slow, { runId: id2, userId: USER });
    expect(out2.pagesDone).toBe(1);
  });

  it("stops the whole run on an error that would repeat, and keeps the page for next time", async () => {
    const db = new FakeDb();
    const id = await runWithPages(db, ["https://a.com/", "https://b.com/"]);
    const extract = vi.fn().mockRejectedValue(new Error("fatal"));
    const out = await stepRun(db, makeDeps({ extract }), { runId: id, userId: USER });
    expect(out.status).toBe("failed");
    expect(out.error).toBe("fatal");
    expect(out.pagesLeft).toBe(2);
    expect(out.pagesDone).toBe(0);
  });

  it("counts an ordinary read failure and moves on", async () => {
    const db = new FakeDb();
    const id = await runWithPages(db, ["https://a.com/", "https://b.com/"]);
    const extract = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider hiccup"))
      .mockResolvedValueOnce(orgPage(org()));
    const out = await stepRun(db, makeDeps({ extract }), { runId: id, userId: USER });
    expect(out.stats).toMatchObject({ errors: 1, candidates: 1 });
    expect(db.rows("listing_discovery_pages").map((p) => p.outcome)).toEqual(["error", "ok"]);
  });
});

describe("stepRun: locking and stopping", () => {
  it("does nothing while another step holds the run", async () => {
    const db = new FakeDb();
    const id = await runWithPages(db, ["https://a.com/"]);
    db.rows("listing_discovery_runs")[0].lock_until = new Date(T0 + 60_000).toISOString();
    const deps = makeDeps();
    const out = await stepRun(db, deps, { runId: id, userId: USER });
    expect(out.busy).toBe(true);
    expect(deps.fetchPage).not.toHaveBeenCalled();

    db.rows("listing_discovery_runs")[0].lock_until = new Date(T0 - 1).toISOString();
    const free = await stepRun(db, deps, { runId: id, userId: USER });
    expect(free.busy).toBe(false);
    expect(deps.fetchPage).toHaveBeenCalledTimes(1);
  });

  it("stays stopped when stopped from another tab mid-step", async () => {
    const db = new FakeDb();
    const id = await runWithPages(db, ["https://a.com/", "https://b.com/", "https://c.com/"]);
    const fetchPage = vi.fn(async (url: string) => {
      await cancelRun(db, id, T0);
      return { ok: true as const, url, page };
    });
    const out = await stepRun(db, makeDeps({ fetchPage }), { runId: id, userId: USER });
    expect(out.status).toBe("cancelled");
    expect(db.rows("listing_discovery_runs")[0].status).toBe("cancelled");
  });

  it("reports a stopped run without doing work, and rejects an unknown one", async () => {
    const db = new FakeDb();
    const id = await runWithPages(db, ["https://a.com/"]);
    await cancelRun(db, id, T0);
    const deps = makeDeps();
    const out = await stepRun(db, deps, { runId: id, userId: USER });
    expect(out.status).toBe("cancelled");
    expect(out.busy).toBe(false);
    expect(deps.fetchPage).not.toHaveBeenCalled();
    await expect(
      stepRun(db, deps, { runId: "00000000-0000-4000-8000-00000000ffff", userId: USER }),
    ).rejects.toThrow(/no longer exists/);
  });
});
