import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { EventsClient } from "./events-read";
import { cancelThroughEvents, copiedEventForWrites, signUpThroughEvents } from "./events-write";

type Result = { data: unknown; error: { message: string } | null };

/** A fake client: per-table results keyed by the eq() key/value seen, RPC results by name. */
function fakeClient(opts: {
  switchValue?: unknown;
  switchError?: boolean;
  copy?: Result;
  rpcs?: Record<string, Result>;
  calls?: string[];
}): EventsClient {
  const calls = opts.calls ?? [];
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "not", "order"])
      b[m] = (...args: unknown[]) => {
        calls.push(`${table}.${m}(${JSON.stringify(args)})`);
        return b;
      };
    b.maybeSingle = () => {
      if (table === "app_settings")
        return Promise.resolve(
          opts.switchError
            ? { data: null, error: { message: "denied" } }
            : {
                data: opts.switchValue === undefined ? null : { value: opts.switchValue },
                error: null,
              },
        );
      return Promise.resolve(opts.copy ?? { data: null, error: null });
    };
    return b as unknown as ReturnType<EventsClient["from"]>;
  };
  return {
    from: (t: string) => builder(t),
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push(`rpc.${fn}(${JSON.stringify(args)})`);
      return Promise.resolve(opts.rpcs?.[fn] ?? { data: null, error: null });
    },
  };
}

const ON = { enabled: true };

describe("copiedEventForWrites", () => {
  it("is null unless events_v2_writes is exactly on", async () => {
    for (const v of [undefined, { enabled: false }, { enabled: "true" }, true]) {
      const calls: string[] = [];
      expect(
        await copiedEventForWrites(
          fakeClient({ switchValue: v, copy: { data: { id: "e1" }, error: null }, calls }),
          "p1",
        ),
      ).toBeNull();
      expect(calls.some((c) => c.startsWith("events."))).toBe(false);
    }
    expect(
      await copiedEventForWrites(
        fakeClient({ switchError: true, copy: { data: { id: "e1" }, error: null } }),
        "p1",
      ),
    ).toBeNull();
  });

  it("reads the writes switch, not the read switch", async () => {
    const calls: string[] = [];
    await copiedEventForWrites(fakeClient({ switchValue: ON, calls }), "p1");
    expect(calls).toContain('app_settings.eq(["key","events_v2_writes"])');
  });

  it("finds the copy by post id, and is null when there is none or the lookup fails", async () => {
    const calls: string[] = [];
    expect(
      await copiedEventForWrites(
        fakeClient({ switchValue: ON, copy: { data: { id: "e1" }, error: null }, calls }),
        "p1",
      ),
    ).toBe("e1");
    expect(calls).toContain('events.eq(["legacy_post_id","p1"])');
    expect(await copiedEventForWrites(fakeClient({ switchValue: ON }), "p1")).toBeNull();
    expect(
      await copiedEventForWrites(
        fakeClient({ switchValue: ON, copy: { data: null, error: { message: "x" } } }),
        "p1",
      ),
    ).toBeNull();
  });
});

describe("signUpThroughEvents / cancelThroughEvents", () => {
  const withCopy = (rpcs: Record<string, Result> = {}, calls: string[] = []) =>
    fakeClient({ switchValue: ON, copy: { data: { id: "e1" }, error: null }, rpcs, calls });

  it("leave the old path in charge when there is no copy to use", async () => {
    const calls: string[] = [];
    const client = fakeClient({ switchValue: { enabled: false }, calls });
    expect(
      await signUpThroughEvents(client, "p1", {
        onBehalfOf: null,
        waiverId: null,
        attested: false,
      }),
    ).toEqual({ handled: false });
    expect(await cancelThroughEvents(client, "p1", null)).toEqual({ handled: false });
    expect(calls.some((c) => c.startsWith("rpc."))).toBe(false);
  });

  it("sign up through register_for_event with the caller's arguments", async () => {
    const calls: string[] = [];
    expect(
      await signUpThroughEvents(withCopy({}, calls), "p1", {
        onBehalfOf: "kid",
        waiverId: "w1",
        attested: true,
      }),
    ).toEqual({ handled: true, error: null });
    expect(calls).toContain(
      'rpc.register_for_event({"_event":"e1","_on_behalf_of":"kid","_waiver_id":"w1","_attested":true})',
    );
  });

  it("cancel through cancel_event_registration", async () => {
    const calls: string[] = [];
    expect(await cancelThroughEvents(withCopy({}, calls), "p1", "kid")).toEqual({
      handled: true,
      error: null,
    });
    expect(calls).toContain('rpc.cancel_event_registration({"_event":"e1","_user":"kid"})');
  });

  it("report an events error as handled, so the caller never retries on the old path", async () => {
    expect(
      await signUpThroughEvents(
        withCopy({ register_for_event: { data: null, error: { message: "EVENT_FULL" } } }),
        "p1",
        { onBehalfOf: null, waiverId: null, attested: false },
      ),
    ).toEqual({ handled: true, error: "EVENT_FULL" });
  });
});

describe("tryout sign-up server functions", () => {
  it("try events first and fall back to the old RPC only when events did not handle it", () => {
    const src = readFileSync("src/lib/tryouts.functions.ts", "utf8");
    for (const [fn, viaEvents, legacy] of [
      ["export const rsvpTryout", "signUpThroughEvents(", 'rpc("rsvp_tryout"'],
      ["export const cancelTryoutRsvp", "cancelThroughEvents(", 'rpc("cancel_tryout_rsvp"'],
    ]) {
      const at = src.indexOf(fn);
      const body = src.slice(at, src.indexOf("export const", at + 10));
      expect(body.indexOf(viaEvents)).toBeGreaterThan(-1);
      expect(body.indexOf(legacy)).toBeGreaterThan(body.indexOf(viaEvents));
      expect(body).toMatch(/viaEvents\.handled\s*\?/);
    }
  });

  it("show a plain message for every events error a copied tryout can raise", () => {
    const src = readFileSync("src/lib/tryouts.functions.ts", "utf8");
    for (const code of ["EVENT_FULL", "EVENT_STARTED", "EVENT_NOT_FOUND", "NOT_ALLOWED"]) {
      expect(src).toMatch(new RegExp(`${code}: "`));
    }
  });
});
