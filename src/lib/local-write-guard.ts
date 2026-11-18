/**
 * Keeps a slow read of the viewer's own rows from undoing what the page wrote
 * after that read was sent.
 *
 * The game page reads the viewer's join request and payment submissions on
 * mount, on realtime events and on focus (refreshStatus), and also writes them
 * itself: the "Request Spot" tap shows a pending request at once, then swaps in
 * the server's row; cancel and leave clear them at once. A read is a snapshot
 * of the server at the moment it was sent. If it answers after a tap, it can
 * hold "no request yet" and wipe the pending request the tap just showed, or
 * the row the server just returned; nothing reads again afterwards, so the
 * button reverts to "Request Spot" (disabled while the request is still out)
 * and stays there.
 *
 * Each own-rows slice gets a guard. A read takes a ticket when it starts and
 * applies its answer only when `settle(ticket)` says "apply": no write began
 * since the ticket was taken, none is still in flight, and no newer read has
 * already been applied. A write calls `beginWrite()` before it touches the slice
 * and the returned `end()` once it has settled (the server's row is in, or the
 * change was rolled back).
 *
 * A dropped answer is not lost: the page reads again once no write is in
 * flight. `settle` says "reread" when the writes that overlapped the read have
 * all settled already; when one is still in flight, its `end()` returns true
 * instead (for the last write to settle), and the caller reads again then.
 */
export type ReadTicket = { readonly seq: number; readonly writes: number };

export type ReadVerdict = "apply" | "drop" | "reread";

export type LocalWriteGuard = {
  /** Call when a read of the slice starts. */
  beginRead(): ReadTicket;
  /**
   * What to do with that read's answer: "apply" it (recorded as the newest
   * applied), "drop" it, or drop it and "reread" now.
   */
  settle(ticket: ReadTicket): ReadVerdict;
  /**
   * Call before the page writes the slice; call the result once the write has
   * settled. It returns true when the caller should read again now.
   */
  beginWrite(): () => boolean;
};

export function createLocalWriteGuard(): LocalWriteGuard {
  let started = 0;
  let applied = 0;
  let writes = 0;
  let inFlight = 0;
  let droppedDuringWrite = false;

  return {
    beginRead() {
      started += 1;
      return { seq: started, writes };
    },
    settle(ticket) {
      if (inFlight > 0) {
        droppedDuringWrite = true;
        return "drop";
      }
      // Every write that overlapped this read has settled: read again now.
      if (ticket.writes !== writes) return "reread";
      // An older read answering after a newer one was applied.
      if (ticket.seq < applied) return "drop";
      applied = ticket.seq;
      return "apply";
    },
    beginWrite() {
      writes += 1;
      inFlight += 1;
      let ended = false;
      return () => {
        if (ended) return false;
        ended = true;
        writes += 1;
        inFlight -= 1;
        if (inFlight > 0 || !droppedDuringWrite) return false;
        droppedDuringWrite = false;
        return true;
      };
    },
  };
}
