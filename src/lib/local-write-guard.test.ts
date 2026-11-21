import { describe, expect, it } from "vitest";
import { createLocalWriteGuard } from "./local-write-guard";

describe("createLocalWriteGuard", () => {
  it("applies a read when the page wrote nothing meanwhile", () => {
    const g = createLocalWriteGuard();
    expect(g.settle(g.beginRead())).toBe("apply");
  });

  // The CI failure: the page's first status read is still out (slow auth
  // round trip) when the player taps "Request Spot". The tap shows a pending
  // request; the read then answers "no request" and must not wipe it.
  it("drops a read sent before a tap that answers while the request is in flight", () => {
    const g = createLocalWriteGuard();
    const mountRead = g.beginRead();
    const end = g.beginWrite();
    expect(g.settle(mountRead)).toBe("drop");
    // The request settles: read again so nothing the dropped read held is lost.
    expect(end()).toBe(true);
    expect(g.settle(g.beginRead())).toBe("apply");
  });

  it("drops a read sent during the write that answers before the write settles", () => {
    const g = createLocalWriteGuard();
    const end = g.beginWrite();
    const focusRead = g.beginRead();
    expect(g.settle(focusRead)).toBe("drop");
    expect(end()).toBe(true);
  });

  it("asks for a fresh read when a read from before the write answers after it settled", () => {
    const g = createLocalWriteGuard();
    const mountRead = g.beginRead();
    const end = g.beginWrite();
    expect(end()).toBe(false); // nothing dropped yet
    expect(g.settle(mountRead)).toBe("reread");
    expect(g.settle(g.beginRead())).toBe("apply");
  });

  it("does not ask for a read when the write settles with nothing dropped", () => {
    const g = createLocalWriteGuard();
    const end = g.beginWrite();
    expect(end()).toBe(false);
    expect(g.settle(g.beginRead())).toBe("apply");
  });

  it("asks for the read again only once the last overlapping write settles", () => {
    const g = createLocalWriteGuard();
    const read = g.beginRead();
    const endA = g.beginWrite();
    const endB = g.beginWrite();
    expect(g.settle(read)).toBe("drop");
    expect(endA()).toBe(false);
    expect(endB()).toBe(true);
    expect(endB()).toBe(false); // ending twice is a no-op
  });

  it("drops an older read that answers after a newer one was applied", () => {
    const g = createLocalWriteGuard();
    const older = g.beginRead();
    const newer = g.beginRead();
    expect(g.settle(newer)).toBe("apply");
    expect(g.settle(older)).toBe("drop");
  });
});
