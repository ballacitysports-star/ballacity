import { describe, expect, it } from "vitest";
import type { JoinRequest } from "./payments";
import { markReviewed, undoReview } from "./optimistic-review";
import { claimLocalWrite, claimNewestRead, newReadOrder } from "./read-order";

const AT = "2026-11-27T12:00:00.000Z";

function req(id: string, status: JoinRequest["status"] = "pending"): JoinRequest {
  return {
    id,
    game_id: "g1",
    player_id: `p-${id}`,
    host_id: "h1",
    status,
    message: null,
    reviewer_notes: null,
    created_at: "2026-11-27T10:00:00.000Z",
    reviewed_at: null,
  };
}

const statuses = (rows: JoinRequest[]) => Object.fromEntries(rows.map((r) => [r.id, r.status]));

/**
 * The page's host request state with the same steps the game page takes: a tap claims a write
 * number and marks one row, an undo puts that row back and sends a fresh read (its number is
 * returned), and a read lands only if it is the newest.
 */
function hostList(initial: JoinRequest[]) {
  const order = newReadOrder();
  let rows = initial;
  return {
    get rows() {
      return rows;
    },
    sendRead: () => ++order.sent,
    answer(readNo: number, serverRows: JoinRequest[]) {
      if (claimNewestRead(order, readNo)) rows = serverRows;
    },
    tap(reqId: string, status: "approved" | "rejected") {
      claimLocalWrite(order);
      const marked = markReviewed(rows, reqId, status, AT);
      rows = marked.rows;
      const before = marked.before;
      return () => {
        rows = undoReview(rows, before, AT);
        return ++order.sent;
      };
    },
  };
}

describe("markReviewed and undoReview", () => {
  it("marks one row and keeps the row as it was", () => {
    const { rows, before } = markReviewed([req("a"), req("b")], "a", "approved", AT);
    expect(rows[0]).toMatchObject({ id: "a", status: "approved", reviewed_at: AT });
    expect(rows[1]).toEqual(req("b"));
    expect(before).toEqual(req("a"));
  });

  it("puts back only its own row", () => {
    const { rows, before } = markReviewed([req("a"), req("b")], "a", "approved", AT);
    const otherChange = rows.map((r) => (r.id === "b" ? { ...r, status: "rejected" as const } : r));
    expect(statuses(undoReview(otherChange, before, AT))).toEqual({ a: "pending", b: "rejected" });
  });

  it("changes nothing when the row was not in the list at the tap", () => {
    const list = [req("b")];
    const { rows, before } = markReviewed(list, "a", "approved", AT);
    expect(before).toBeUndefined();
    expect(undoReview(rows, before, AT)).toEqual(list);
  });

  it("does not bring back a row that has left the list since the tap", () => {
    const { before } = markReviewed([req("a"), req("b")], "a", "approved", AT);
    expect(undoReview([req("b")], before, AT)).toEqual([req("b")]);
  });

  it("leaves a row a read has replaced since the tap", () => {
    const { before } = markReviewed([req("a")], "a", "approved", AT);
    // The review threw on the way back but landed, and a read already shows the server's row.
    const server = { ...req("a", "approved"), reviewed_at: "2026-11-27T12:00:01.000Z" };
    expect(undoReview([server], before, AT)).toEqual([server]);
  });
});

describe("host request list: taps, undos and reads", () => {
  it("drops a read sent before the tap that answers after it", () => {
    const list = hostList([req("a")]);
    const stale = list.sendRead();
    list.tap("a", "approved");
    list.answer(stale, [req("a")]);
    expect(statuses(list.rows)).toEqual({ a: "approved" });
  });

  it("keeps the undo when a read sent before the tap answers after the undo", () => {
    const list = hostList([req("a"), req("b")]);
    const stale = list.sendRead();
    const undo = list.tap("a", "approved");
    undo();
    // This read went out before the host's tap; it must not replace what the undo put back.
    list.answer(stale, [req("a"), req("b", "rejected")]);
    expect(statuses(list.rows)).toEqual({ a: "pending", b: "pending" });
  });

  it("lets a read sent after the tap land after the undo", () => {
    const list = hostList([req("a"), req("b")]);
    const undo = list.tap("a", "approved");
    const fresh = list.sendRead();
    undo();
    list.answer(fresh, [req("a"), req("b", "rejected")]);
    expect(statuses(list.rows)).toEqual({ a: "pending", b: "rejected" });
  });

  it("keeps a newer list that landed before the undo", () => {
    const list = hostList([req("a"), req("b")]);
    const undo = list.tap("a", "approved");
    const fresh = list.sendRead();
    // The server still has "a" pending, since the review is about to fail; "b" changed elsewhere.
    list.answer(fresh, [req("a"), req("b", "rejected"), req("c")]);
    undo();
    expect(statuses(list.rows)).toEqual({ a: "pending", b: "rejected", c: "pending" });
  });

  it("keeps a second tap's mark when the first tap fails", () => {
    const list = hostList([req("a"), req("b")]);
    const undoA = list.tap("a", "approved");
    list.tap("b", "rejected");
    undoA();
    expect(statuses(list.rows)).toEqual({ a: "pending", b: "rejected" });
  });

  it("keeps the server's row when the review threw but a read shows it landed", () => {
    const list = hostList([req("a")]);
    const undo = list.tap("a", "approved");
    const fresh = list.sendRead();
    list.answer(fresh, [{ ...req("a", "approved"), reviewed_at: "2026-11-27T12:00:01.000Z" }]);
    undo();
    expect(statuses(list.rows)).toEqual({ a: "approved" });
  });

  it("recovers what a read dropped by the tap carried, through the undo's own read", () => {
    const list = hostList([req("a")]);
    // A new request from "b" sends a read; the host taps "a" before it answers, and the review fails.
    const inFlight = list.sendRead();
    const undo = list.tap("a", "rejected");
    const reread = undo();
    list.answer(inFlight, [req("a"), req("b")]);
    // Dropped: it was sent before the tap, so "b" is not shown yet.
    expect(statuses(list.rows)).toEqual({ a: "pending" });
    list.answer(reread, [req("a"), req("b")]);
    expect(statuses(list.rows)).toEqual({ a: "pending", b: "pending" });
  });

  it("does not bring back the first tap's mark when the second tap fails after it", () => {
    const list = hostList([req("a"), req("b")]);
    const undoA = list.tap("a", "approved");
    const undoB = list.tap("b", "rejected");
    undoA();
    undoB();
    expect(statuses(list.rows)).toEqual({ a: "pending", b: "pending" });
  });
});
