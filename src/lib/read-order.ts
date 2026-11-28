/**
 * Send order of several reads of the same rows. A page can have more than one read out at once
 * (the read on mount, a change event, a focus, the catch-up on every SUBSCRIBED of a live channel)
 * and they can answer in either order. When each answer replaces the rows wholesale, an answer
 * from a read sent earlier is older and must not replace one from a read sent later.
 *
 * Usage: take `const readNo = ++order.sent` just before sending the read, and apply its answer
 * only when `claimNewestRead(order, readNo)` returns true. A failed read claims nothing, so it
 * never blocks the answer of a read sent before it.
 *
 * A local write of the same rows (an optimistic update, or rows a save just returned) is newer
 * than every read already out, so it takes its own number with `claimLocalWrite` before it sets
 * the rows. Reads sent before it then answer too late to replace it; reads sent after it still land.
 */
export type ReadOrder = { sent: number; newestApplied: number };

export function newReadOrder(): ReadOrder {
  return { sent: 0, newestApplied: 0 };
}

/**
 * Whether read `readNo`'s answer may be applied, recording it as applied when it may. The same
 * number may be claimed twice, so one read can apply an early part of its answer and then the rest.
 */
export function claimNewestRead(order: ReadOrder, readNo: number): boolean {
  if (readNo < order.newestApplied) return false;
  order.newestApplied = readNo;
  return true;
}

/**
 * Claim a fresh number for a local write of the rows and return it. The claim always succeeds,
 * since no read has a higher number yet, and from then on every read sent before the write is
 * dropped. The claim is never given back: `newestApplied` only grows, so undoing the write later
 * does not let those older reads land again.
 */
export function claimLocalWrite(order: ReadOrder): number {
  const writeNo = ++order.sent;
  claimNewestRead(order, writeNo);
  return writeNo;
}
