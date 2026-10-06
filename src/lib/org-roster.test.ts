import { describe, expect, it } from "vitest";
import { firstVisibleOrgLink, toPublicRoster, type RawRosterRow } from "@/lib/org-roster";

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
