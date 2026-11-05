/**
 * Server functions deserialize untrusted request bodies and `payload` query strings with seroval's fromJSON
 * (@tanstack/start-server-core server-functions-handler). seroval <= 1.6.7 had an unauthenticated event-loop DoS
 * (GHSA-97r2-qh9m-474h, GHSA-wp97-x4hv-qvhp) and called an attacker-chosen `source.on` while deserializing
 * (GHSA-7rv5-mrxv-xcr9). These tests pin the patched behaviour: the handler's own copy of seroval is at least
 * 1.6.11, and malformed nodes are refused quickly instead of being trusted.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fromJSON } from "seroval";
import { describe, expect, it } from "vitest";

function versionAtLeast(v: string, min: [number, number, number]) {
  const p = v.split(".").map((x) => parseInt(x, 10));
  for (let i = 0; i < 3; i++) {
    if ((p[i] ?? 0) > min[i]) return true;
    if ((p[i] ?? 0) < min[i]) return false;
  }
  return true;
}

/** The directory of an installed package, found the way Node does: walking up node_modules from here. */
function packageDir(pkg: string) {
  let dir = dirname(new URL(import.meta.url).pathname);
  for (;;) {
    const candidate = join(dir, "node_modules", pkg);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const up = dirname(dir);
    if (up === dir) throw new Error(`${pkg} is not installed`);
    dir = up;
  }
}

/** The version of the seroval copy that `fromPackage` loads (resolved from inside that package). */
function serovalVersionSeenBy(fromPackage: string) {
  const req = createRequire(join(packageDir(fromPackage), "package.json"));
  let dir = dirname(req.resolve("seroval"));
  while (!existsSync(join(dir, "package.json")) || !dir.includes("seroval")) dir = dirname(dir);
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version as string;
}

const wrap = (t: unknown) => ({ t, f: 127, m: [] });
const refusedQuickly = (payload: unknown) => {
  const t0 = performance.now();
  expect(() => fromJSON(payload as never)).toThrow();
  expect(performance.now() - t0).toBeLessThan(250);
};

describe("server-function payload deserialization (F01)", () => {
  it("the server-function handler and the router load a patched seroval (>= 1.6.11)", () => {
    for (const pkg of ["@tanstack/start-server-core", "@tanstack/router-core", "seroval"]) {
      const v = serovalVersionSeenBy(pkg);
      expect(versionAtLeast(v, [1, 6, 11]), `${pkg} resolves seroval ${v}`).toBe(true);
    }
  });

  it("refuses an async-iterator instance whose source is not a stream (no attacker-chosen source.on)", () => {
    refusedQuickly(
      wrap({
        t: 30,
        i: 0,
        a: [
          { t: 0, s: 1 },
          { t: 10, i: 1, p: { k: ["on"], v: [{ t: 0, s: 1 }] }, o: 0 },
        ],
      }),
    );
  });

  it("refuses an iterator instance whose source is not a sequence", () => {
    refusedQuickly(
      wrap({
        t: 28,
        i: 0,
        a: [
          { t: 0, s: 1 },
          { t: 10, i: 1, p: { k: ["v"], v: [{ t: 0, s: 1 }] }, o: 0 },
        ],
      }),
    );
  });

  it("refuses sequence nodes whose done/throw index is outside the items (the event-loop DoS)", () => {
    refusedQuickly(wrap({ t: 35, i: 0, a: [], s: -1, l: 1_000_000_000 }));
    refusedQuickly(wrap({ t: 35, i: 0, a: [{ t: 0, s: 1 }], s: 5_000_000, l: 0 }));
  });

  it("refuses a typed array that claims more elements than its buffer holds", () => {
    refusedQuickly(
      wrap({ t: 15, i: 0, c: "Uint8Array", f: { t: 19, i: 1, s: "AAAA" }, b: 0, l: 1_000_000_000 }),
    );
  });

  it("refuses very deep nesting with a depth error instead of exhausting the stack", () => {
    let deep: Record<string, unknown> = { t: 9, i: 0, a: [], o: 0 };
    for (let k = 1; k < 20_000; k++) deep = { t: 9, i: k, a: [deep], o: 0 };
    refusedQuickly(wrap(deep));
  });

  it("still round-trips an ordinary server-function payload", () => {
    const payload = wrap({
      t: 10,
      i: 0,
      p: {
        k: ["data", "context"],
        v: [
          {
            t: 9,
            i: 1,
            a: [
              { t: 0, s: 1 },
              { t: 1, s: "two" },
            ],
            o: 0,
          },
          { t: 10, i: 2, p: { k: [], v: [] }, o: 0 },
        ],
      },
      o: 0,
    });
    expect(fromJSON(payload as never)).toEqual({ data: [1, "two"], context: {} });
  });
});
