import { describe, expect, it } from "vitest";
import {
  findSelfOverlaps,
  findSlotConflicts,
  gameToBusyBlock,
  suggestSlotFixes,
  dropOverlappingSlots,
  type BusyBlock,
} from "./availability-conflicts";
import { toDateKey, type TimeSlot } from "./availability-timeslots";

const block = (over: Partial<BusyBlock> = {}): BusyBlock => ({
  id: "b1",
  date: "2026-08-01",
  start: "18:00",
  end: "20:00",
  label: "Saturday run",
  kind: "joined",
  ...over,
});

describe("gameToBusyBlock", () => {
  it("derives an end time from the duration string", () => {
    const start = new Date(2026, 7, 1, 18, 0);
    const b = gameToBusyBlock(
      { id: "g1", title: "Hoops", date: start.toISOString(), duration: "90 min" },
      "joined",
    );
    expect(b).toMatchObject({
      date: toDateKey(start),
      start: "18:00",
      end: "19:30",
      kind: "joined",
    });
  });
  it("falls back to 90 minutes on a junk duration", () => {
    const start = new Date(2026, 7, 1, 8, 0);
    const b = gameToBusyBlock(
      { id: "g", title: null, date: start.toISOString(), duration: null },
      "hosting",
    );
    expect(b?.end).toBe("09:30");
  });
});

describe("findSlotConflicts", () => {
  it("flags a date slot that overlaps a joined game", () => {
    const slots: TimeSlot[] = [{ date: "2026-08-01", start: "19:00", end: "21:00" }];
    const out = findSlotConflicts(slots, [block()]);
    expect(out).toHaveLength(1);
    expect(out[0].blocks[0].kind).toBe("joined");
  });

  it("does not flag adjacent, non-overlapping windows", () => {
    const slots: TimeSlot[] = [{ date: "2026-08-01", start: "20:00", end: "22:00" }];
    expect(findSlotConflicts(slots, [block()])).toHaveLength(0);
  });

  it("expands weekly slots and flags a matching weekday", () => {
    const now = new Date(2026, 6, 30, 9, 0); // Thursday
    const slots: TimeSlot[] = [{ weekday: 6, start: "18:30", end: "20:30" }]; // Saturday
    const out = findSlotConflicts(slots, [block()], { now });
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-08-01");
  });

  it("reports at most one conflict per slot", () => {
    const now = new Date(2026, 6, 30, 9, 0);
    const busy = [block(), block({ id: "b2", date: "2026-08-08" })];
    const out = findSlotConflicts([{ weekday: 6, start: "18:30", end: "20:30" }], busy, { now });
    expect(out).toHaveLength(1);
  });

  it("flags unavailable blocks too", () => {
    const out = findSlotConflicts(
      [{ date: "2026-08-01", start: "18:00", end: "19:00" }],
      [block({ kind: "unavailable", label: "Marked unavailable" })],
    );
    expect(out[0].blocks[0].kind).toBe("unavailable");
  });
});

describe("findSelfOverlaps", () => {
  it("detects two overlapping weekly windows", () => {
    expect(
      findSelfOverlaps([
        { weekday: 2, start: "18:00", end: "20:00" },
        { weekday: 2, start: "19:00", end: "21:00" },
      ]),
    ).toEqual([0, 1]);
  });
  it("ignores different weekdays", () => {
    expect(
      findSelfOverlaps([
        { weekday: 2, start: "18:00", end: "20:00" },
        { weekday: 3, start: "18:00", end: "20:00" },
      ]),
    ).toEqual([]);
  });
});

describe("suggestSlotFixes", () => {
  const conflict = (slot: TimeSlot, blocks: BusyBlock[]) => findSlotConflicts([slot], blocks)[0];

  it("offers a skip to right after the busy block", () => {
    const fixes = suggestSlotFixes(
      conflict({ date: "2026-08-01", start: "17:00", end: "19:00" }, [block()]),
    );
    const skip = fixes.find((f) => f.id === "skip")!;
    expect(skip.slot).toMatchObject({ start: "20:00", end: "22:00" });
  });

  it("shortens to the longer free side", () => {
    const fixes = suggestSlotFixes(
      conflict({ date: "2026-08-01", start: "14:00", end: "19:00" }, [block()]),
    );
    const short = fixes.find((f) => f.id === "shorten")!;
    expect(short.slot).toMatchObject({ start: "14:00", end: "18:00" });
  });

  it("skips the shorten option when no free side is long enough", () => {
    const fixes = suggestSlotFixes(
      conflict({ date: "2026-08-01", start: "18:00", end: "20:00" }, [block()]),
    );
    expect(fixes.some((f) => f.id === "shorten")).toBe(false);
  });

  it("always offers remove", () => {
    const fixes = suggestSlotFixes(
      conflict({ date: "2026-08-01", start: "18:00", end: "20:00" }, [block()]),
    );
    expect(fixes.at(-1)).toMatchObject({ id: "remove" });
  });

  it("keeps the weekday when skipping a recurring window", () => {
    const now = new Date(2026, 6, 30, 9, 0);
    const c = findSlotConflicts([{ weekday: 6, start: "17:00", end: "19:00" }], [block()], {
      now,
    })[0];
    const skip = suggestSlotFixes(c).find((f) => f.id === "skip")!;
    expect(skip.slot).toMatchObject({ weekday: 6, start: "20:00" });
  });

  it("omits skip when the clash runs to the end of the day", () => {
    const fixes = suggestSlotFixes(
      conflict({ date: "2026-08-01", start: "22:00", end: "23:30" }, [
        block({ start: "22:00", end: "23:59" }),
      ]),
    );
    expect(fixes.map((f) => f.id)).toEqual(["remove"]);
  });
});

describe("dropOverlappingSlots", () => {
  it("keeps the first of two clashing windows", () => {
    expect(
      dropOverlappingSlots([
        { weekday: 2, start: "18:00", end: "20:00" },
        { weekday: 2, start: "19:00", end: "21:00" },
        { weekday: 3, start: "19:00", end: "21:00" },
      ]),
    ).toEqual([
      { weekday: 2, start: "18:00", end: "20:00" },
      { weekday: 3, start: "19:00", end: "21:00" },
    ]);
  });
});
