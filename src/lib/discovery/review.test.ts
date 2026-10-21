import { describe, expect, it, vi } from "vitest";
import { FakeDb } from "./fake-db";
import {
  BULK_APPROVE_MIN_CONFIDENCE,
  CANDIDATE_EDITS,
  approveCandidate,
  bulkApprovable,
  listCandidates,
  listingInputFor,
  rejectCandidate,
  type CandidateRow,
} from "./review.server";
import type { UnclaimedListingInput } from "@/lib/listings-create.server";

const ME = "00000000-0000-4000-8000-0000000000aa";
const NOW = "2026-10-21T12:00:00.000Z";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function cand(over: Partial<CandidateRow> & { id: string }): CandidateRow {
  return {
    subject_type: "gym",
    name: "Peach State Hoops",
    city: "Atlanta",
    state: "GA",
    address: "12 Court St",
    website: "https://peachhoops.com/",
    sports: ["Basketball"],
    category: "Indoor courts",
    description: null,
    source: "search",
    source_url: "https://peachhoops.com/about",
    confidence: 0.9,
    duplicate_of: null,
    status: "pending",
    reject_reason: null,
    created_listing_id: null,
    created_at: "2026-10-21T10:00:00.000Z",
    ...over,
  };
}

function setup(rows: CandidateRow[]) {
  const db = new FakeDb({ listing_candidates: rows as never });
  const create = vi.fn(async (_: UnclaimedListingInput) => ({
    id: "LISTING-1",
    subjectType: "gym" as const,
  }));
  const row = (id: string) => db.rows("listing_candidates").find((r) => r.id === id)!;
  return { db, create, row, deps: { create, reviewerId: ME, nowIso: NOW } };
}

describe("approveCandidate", () => {
  it("creates an unclaimed gym from the find and links it", async () => {
    const { db, deps, create, row } = setup([cand({ id: ID(1) })]);
    const done = await approveCandidate(db, deps, { id: ID(1) });
    expect(create).toHaveBeenCalledWith({
      subjectType: "gym",
      name: "Peach State Hoops",
      handle: "peach-state-hoops",
      city: "Atlanta",
      category: "Indoor courts",
      address: "12 Court St",
      website: "https://peachhoops.com/",
    });
    expect(done.listingId).toBe("LISTING-1");
    expect(row(ID(1))).toMatchObject({
      status: "approved",
      reviewed_by: ME,
      reviewed_at: NOW,
      created_listing_id: "LISTING-1",
    });
  });

  it("creates a trainer as a coach listing without an address or website", async () => {
    const { db, deps, create } = setup([
      cand({
        id: ID(2),
        subject_type: "coach",
        name: "Coach Dre Training",
        address: null,
        category: null,
        sports: ["Basketball", "Soccer"],
      }),
    ]);
    create.mockResolvedValueOnce({ id: "t-dre", subjectType: "team" as never });
    await approveCandidate(db, deps, { id: ID(2) });
    expect(create).toHaveBeenCalledWith({
      subjectType: "team",
      kind: "coach",
      name: "Coach Dre Training",
      handle: "coach-dre-training",
      city: "Atlanta",
      sports: ["Basketball", "Soccer"],
    });
  });

  it("applies the reviewer's edits", async () => {
    const { db, deps, create } = setup([cand({ id: ID(3) })]);
    await approveCandidate(db, deps, {
      id: ID(3),
      edits: {
        name: "Peach State Hoops Gym",
        city: "Decatur",
        address: null,
        category: "Gym",
        website: "peachstate.org",
      },
    });
    expect(create).toHaveBeenCalledWith({
      subjectType: "gym",
      name: "Peach State Hoops Gym",
      handle: "peach-state-hoops-gym",
      city: "Decatur",
      category: "Gym",
      address: undefined,
      website: "https://peachstate.org/",
    });
  });

  it("tries the next handle when one is taken, but stops on any other error", async () => {
    const taken = setup([cand({ id: ID(4) })]);
    taken.create
      .mockRejectedValueOnce(new Error("HANDLE_TAKEN"))
      .mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint "teams_handle_key"'),
      );
    await approveCandidate(taken.db, taken.deps, { id: ID(4) });
    expect(taken.create.mock.calls.map(([i]) => i.handle)).toEqual([
      "peach-state-hoops",
      "peach-state-hoops-atlanta",
      "peach-state-hoops-2",
    ]);

    const denied = setup([cand({ id: ID(5) })]);
    denied.create.mockRejectedValue(new Error("NOT_MODERATOR"));
    await expect(approveCandidate(denied.db, denied.deps, { id: ID(5) })).rejects.toThrow(
      "NOT_MODERATOR",
    );
    expect(denied.create).toHaveBeenCalledTimes(1);
    // Put back, so it can be tried again.
    expect(denied.row(ID(5))).toMatchObject({
      status: "pending",
      reviewed_by: null,
      reviewed_at: null,
    });
  });

  it("gives up cleanly when every handle is taken", async () => {
    const { db, deps, create, row } = setup([cand({ id: ID(6) })]);
    create.mockRejectedValue(new Error("HANDLE_TAKEN"));
    await expect(approveCandidate(db, deps, { id: ID(6) })).rejects.toThrow("HANDLE_TAKEN");
    expect(create).toHaveBeenCalledTimes(5);
    expect(row(ID(6)).status).toBe("pending");
    expect(row(ID(6)).created_listing_id).toBeNull();
  });

  it("asks for confirmation before adding a likely repeat", async () => {
    const dup = { kind: "gym", id: "g1", name: "Peach State Hoops Academy", score: 0.8 };
    const { db, deps, create, row } = setup([cand({ id: ID(7), duplicate_of: dup })]);
    await expect(approveCandidate(db, deps, { id: ID(7) })).rejects.toThrow(
      /may repeat "Peach State Hoops Academy"/,
    );
    expect(create).not.toHaveBeenCalled();
    expect(row(ID(7)).status).toBe("pending");
    await approveCandidate(db, deps, { id: ID(7), confirmDuplicate: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("will not approve the same find twice", async () => {
    const { db, deps, create } = setup([cand({ id: ID(8) })]);
    await approveCandidate(db, deps, { id: ID(8) });
    await expect(approveCandidate(db, deps, { id: ID(8) })).rejects.toThrow(/already reviewed/);
    expect(create).toHaveBeenCalledTimes(1);
    await expect(approveCandidate(db, deps, { id: ID(99) })).rejects.toThrow(/no longer exists/);
  });

  it("refuses edits the app cannot store", () => {
    for (const bad of [
      { name: "x" },
      { website: "http://localhost/" },
      { website: "https://facebook.com/gym" },
      { sports: ["Curling"] },
      { category: "Dungeon" },
    ]) {
      expect(CANDIDATE_EDITS.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(
      CANDIDATE_EDITS.safeParse({ website: "", category: null, sports: ["Soccer"] }).success,
    ).toBe(true);
  });
});

describe("rejectCandidate", () => {
  it("records who rejected it and why", async () => {
    const { db, row } = setup([cand({ id: ID(10) })]);
    await rejectCandidate(
      db,
      { reviewerId: ME, nowIso: NOW },
      { id: ID(10), reason: "  Closed down  " },
    );
    expect(row(ID(10))).toMatchObject({
      status: "rejected",
      reject_reason: "Closed down",
      reviewed_by: ME,
    });
  });

  it("only acts on a find still waiting", async () => {
    const { db } = setup([cand({ id: ID(11), status: "approved" })]);
    await expect(
      rejectCandidate(db, { reviewerId: ME, nowIso: NOW }, { id: ID(11) }),
    ).rejects.toThrow(/already reviewed/);
  });
});

describe("listCandidates", () => {
  const rows = [
    cand({ id: ID(20), name: "Alpha Gym", confidence: 0.6 }),
    cand({ id: ID(21), name: "Beta Gym", confidence: 0.95 }),
    cand({
      id: ID(22),
      name: "Coach Cee",
      subject_type: "coach",
      city: "Decatur",
      confidence: 0.8,
    }),
    cand({ id: ID(23), name: "Old Team", subject_type: "team", status: "approved" }),
    cand({ id: ID(24), name: "Nope Gym", status: "rejected" }),
  ];

  it("lists the most confident first and counts every status", async () => {
    const { db } = setup(rows);
    const out = await listCandidates(db, { status: "pending", limit: 25, offset: 0 });
    expect(out.rows.map((r) => r.name)).toEqual(["Beta Gym", "Coach Cee", "Alpha Gym"]);
    expect(out.total).toBe(3);
    expect(out.counts).toEqual({ pending: 3, approved: 1, rejected: 1 });
  });

  it("filters by type and by name or city", async () => {
    const { db } = setup(rows);
    expect(
      (await listCandidates(db, { status: "pending", type: "coach", limit: 25, offset: 0 })).rows,
    ).toHaveLength(1);
    const byCity = await listCandidates(db, {
      status: "pending",
      search: "decatur",
      limit: 25,
      offset: 0,
    });
    expect(byCity.rows.map((r) => r.name)).toEqual(["Coach Cee"]);
    const paged = await listCandidates(db, { status: "pending", limit: 1, offset: 1 });
    expect(paged.rows.map((r) => r.name)).toEqual(["Coach Cee"]);
    expect(paged.total).toBe(3);
  });
});

describe("bulk approval", () => {
  it("takes only confident finds that repeat nothing", () => {
    const ok = {
      status: "pending" as const,
      confidence: BULK_APPROVE_MIN_CONFIDENCE,
      duplicate_of: null,
    };
    expect(bulkApprovable(ok)).toBe(true);
    expect(bulkApprovable({ ...ok, confidence: 0.74 })).toBe(false);
    expect(
      bulkApprovable({ ...ok, duplicate_of: { kind: "gym", id: "g", name: "x", score: 0.8 } }),
    ).toBe(false);
    expect(bulkApprovable({ ...ok, status: "rejected" as never })).toBe(false);
  });
});

describe("listingInputFor", () => {
  it("never sends a trainer's address or website, whatever was stored", () => {
    const input = listingInputFor(
      cand({
        id: ID(30),
        subject_type: "coach",
        address: "5 Home Ln",
        website: "https://dre.com/",
      }),
      {},
      "dre",
    );
    expect(input).toEqual({
      subjectType: "team",
      kind: "coach",
      name: "Peach State Hoops",
      handle: "dre",
      city: "Atlanta",
      sports: ["Basketball"],
    });
  });
});
