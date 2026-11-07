import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { KNOWN_TWINS, dedupeMigrations, fileDigest } from "./migration-twins.mjs";

const m = (name, digest) => ({ name, path: `/x/${name}`, digest });
const byDigest = (x) => x.digest;

describe("dedupeMigrations (P0-4)", () => {
  it("replays every distinct migration once, in order", () => {
    const out = dedupeMigrations([m("a.sql", "1"), m("b.sql", "2"), m("c.sql", "3")], byDigest);
    expect(out.replay.map((x) => x.name)).toEqual(["a.sql", "b.sql", "c.sql"]);
    expect(out.skipped).toEqual([]);
  });

  it("applies a known twin pair once, whichever copy comes first", () => {
    const [sb, dz] = Object.entries(KNOWN_TWINS)[0];
    for (const order of [
      [sb, dz],
      [dz, sb],
    ]) {
      const out = dedupeMigrations(
        [m(order[0], "same"), m("other.sql", "x"), m(order[1], "same")],
        byDigest,
      );
      expect(out.replay.map((x) => x.name)).toEqual([order[0], "other.sql"]);
      expect(out.skipped).toEqual([{ name: order[1], twinOf: order[0] }]);
    }
  });

  it("fails on any new duplicate, naming both files", () => {
    expect(() =>
      dedupeMigrations([m("20270101000000_new.sql", "d"), m("0099_new.sql", "d")], byDigest),
    ).toThrow(/Duplicate migration: 0099_new\.sql is identical to 20270101000000_new\.sql/);
  });

  it("does not let a known name excuse a pair it was not listed with", () => {
    const [sb] = Object.entries(KNOWN_TWINS)[0];
    expect(() => dedupeMigrations([m(sb, "d"), m("0099_other.sql", "d")], byDigest)).toThrow(
      /Duplicate migration/,
    );
  });

  it("the allow-list matches the repository exactly: every pair exists and is identical, and there are no others", () => {
    const journal = JSON.parse(readFileSync("drizzle/migrations/meta/_journal.json", "utf8"));
    const files = [
      ...readdirSync("supabase/migrations")
        .filter((f) => f.endsWith(".sql"))
        .map((f) => ({ name: f, path: `supabase/migrations/${f}` })),
      ...journal.entries.map((e) => ({
        name: `${e.tag}.sql`,
        path: `drizzle/migrations/${e.tag}.sql`,
      })),
    ];
    const groups = new Map();
    for (const f of files) {
      const d = fileDigest(f.path);
      groups.set(d, [...(groups.get(d) ?? []), f.name]);
    }
    const dupes = [...groups.values()].filter((g) => g.length > 1).map((g) => [...g].sort());
    const known = Object.entries(KNOWN_TWINS).map((p) => [...p].sort());
    expect(dupes.sort()).toEqual(known.sort());
  });
});
