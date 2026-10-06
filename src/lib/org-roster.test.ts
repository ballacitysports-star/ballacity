import { describe, expect, it } from "vitest";
import {
  facilityByTrainer,
  firstVisibleOrgLink,
  toPublicRoster,
  type RawRosterRow,
} from "@/lib/org-roster";

const team = (over = {}) => ({
  id: "t1",
  name: "Coach A",
  handle: "@a",
  avatar: null,
  city: "Austin",
  sports: ["Basketball"],
  hidden_at: null,
  ...over,
});
const row = (over: Partial<RawRosterRow> = {}): RawRosterRow => ({
  id: "m1",
  trainer_id: "t1",
  role: "member",
  joined_at: "2026-10-01T00:00:00Z",
  teams: team(),
  user_id: "11111111-1111-1111-1111-111111111111",
  ...over,
});

describe("toPublicRoster", () => {
  it("never passes a user id through", () => {
    const out = toPublicRoster([row()]);
    expect(out).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain("11111111");
    expect(Object.keys(out[0])).not.toContain("user_id");
    expect(Object.keys(out[0].teams)).not.toContain("hidden_at");
  });

  it("drops hidden or missing trainer profiles and keeps order", () => {
    const out = toPublicRoster([
      row({ id: "a", teams: team({ id: "ta" }) }),
      row({ id: "b", teams: team({ id: "tb", hidden_at: "2026-10-02T00:00:00Z" }) }),
      row({ id: "c", teams: null }),
      row({ id: "d", teams: team({ id: "td" }) }),
    ]);
    expect(out.map((m) => m.id)).toEqual(["a", "d"]);
  });
});

describe("firstVisibleOrgLink", () => {
  const org = (over = {}) => ({
    id: "o1",
    name: "Peak Courts",
    handle: "peak",
    avatar: null,
    city: "Austin",
    verified: true,
    hidden_at: null,
    ...over,
  });

  it("returns the first facility that isn't hidden, without hidden_at", () => {
    const link = firstVisibleOrgLink([
      { role: "member", org: org({ id: "hidden", hidden_at: "2026-10-01T00:00:00Z" }) },
      { role: "admin", org: org({ id: "ok" }) },
    ]);
    expect(link).toEqual({
      role: "admin",
      org: {
        id: "ok",
        name: "Peak Courts",
        handle: "peak",
        avatar: null,
        city: "Austin",
        verified: true,
      },
    });
  });

  it("is null when the trainer has no visible facility", () => {
    expect(firstVisibleOrgLink([])).toBeNull();
    expect(firstVisibleOrgLink([{ role: "member", org: null }])).toBeNull();
    expect(
      firstVisibleOrgLink([{ role: "member", org: org({ hidden_at: "2026-10-01T00:00:00Z" }) }]),
    ).toBeNull();
  });
});

describe("facilityByTrainer", () => {
  const o = (id: string, name: string, hidden_at: string | null = null) => ({
    id,
    name,
    hidden_at,
  });

  it("maps each trainer to their first visible facility, public fields only", () => {
    const map = facilityByTrainer([
      { trainer_id: "t1", org: o("hidden", "Closed Gym", "2026-10-01T00:00:00Z") },
      { trainer_id: "t1", org: o("a", "Apex") },
      { trainer_id: "t1", org: o("b", "Other") },
      { trainer_id: "t2", org: null },
      { trainer_id: "t3", org: o("c", "Peak") },
    ]);
    expect(map).toEqual({ t1: { id: "a", name: "Apex" }, t3: { id: "c", name: "Peak" } });
    expect(JSON.stringify(map)).not.toContain("hidden_at");
  });
});
