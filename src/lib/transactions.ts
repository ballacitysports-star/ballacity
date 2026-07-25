// Closed transactions registry (prototype).
// A user can only review another user/team/host/trainer they've shared a
// completed transaction with — game played, training delivered, team tryout
// attended, hosted event paid for, etc.
//
// In the real app this is sourced from the DB (join_requests + games in the
// past, payment_submissions with status='approved', purchases, etc).
// Here we seed it from the sample data so the gating UI is demonstrable.

import { useSyncExternalStore } from "react";
import { GAMES } from "@/lib/sample-data";

export type TxnKind = "game" | "training" | "tryout" | "event";

export type ClosedTxn = {
  id: string;
  counterpartyId: string; // revieweeId you may now review
  counterpartyName: string;
  kind: TxnKind;
  context: string; // e.g. "Friday Night Run · 5v5"
  date: string; // ISO, when it closed
};

const hostIdFor = (username: string) => `host-${username.replace(/^@/, "").toLowerCase()}`;

function ago(days: number) {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

// Seed: ME has completed these. Counterparty IDs match the IDs used elsewhere
// (host-<username>, t-<team-slug>, c-<coach-slug>, and host-<username> per
// games sample). Edit/extend as the real backend lands.
const seeded: ClosedTxn[] = [
  // games (host = counterparty)
  ...GAMES.slice(0, 4).map((g, i) => ({
    id: `txn-g-${g.id}`,
    counterpartyId: hostIdFor(g.host.username),
    counterpartyName: g.host.name,
    kind: "game" as const,
    context: g.title,
    date: ago(2 + i * 3),
  })),
  // training
  {
    id: "txn-tr-1",
    counterpartyId: "c-jordan-kim",
    counterpartyName: "Trainer Jordan Kim",
    kind: "training",
    context: "Spring 5K Block · Week 6",
    date: ago(8),
  },
  // team tryout
  {
    id: "txn-ty-1",
    counterpartyId: "t-eastside-elite",
    counterpartyName: "Eastside Elite",
    kind: "tryout",
    context: "Open Tryouts · Day 2",
    date: ago(20),
  },
  // hosted event (revieweeId === "me" comes from other users' POV; for ME's
  // own write-review screen we don't gate self-reviews — they're blocked anyway)
];

let txns: ClosedTxn[] = [...seeded];
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function addClosedTransaction(t: ClosedTxn) {
  txns = [t, ...txns];
  emit();
}

export function getClosedTransactions(): ClosedTxn[] {
  return txns;
}

export function canReviewUser(revieweeId: string): boolean {
  if (!revieweeId || revieweeId === "me") return false;
  return txns.some((t) => t.counterpartyId === revieweeId);
}

export function transactionsWith(revieweeId: string): ClosedTxn[] {
  return txns.filter((t) => t.counterpartyId === revieweeId);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useCanReview(revieweeId: string): boolean {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return canReviewUser(revieweeId);
}

export function useTransactionsWith(revieweeId: string): ClosedTxn[] {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return transactionsWith(revieweeId);
}
