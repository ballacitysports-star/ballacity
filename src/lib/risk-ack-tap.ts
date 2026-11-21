/**
 * Whether a join tap must show "Before you join", decided from the
 * acknowledgment read (useSafetyAck) without holding the tap open-ended.
 *
 * - The read answered: ask exactly when the answer is not the current version.
 * - The read failed with no answer: ask (fail closed). Recording the
 *   acknowledgment again is idempotent.
 * - The read has not answered yet (a tap right after the page opened): wait for
 *   it, but only for `RISK_ACK_WAIT_MS`, so a player who already acknowledged
 *   is not asked again just because the read was a moment late. The CTA says
 *   "Checking…" meanwhile. A read still out after that (a slow or offline
 *   network, or react-query retrying a failed first fetch, which keeps it
 *   pending for ~7 s) asks, as a failed read does.
 *
 * The acknowledgment is never skipped for a viewer who has not given it: the
 * only way past the dialog is an answer that holds the current version.
 */

/** How long a tap waits for the acknowledgment read before asking anyway. */
export const RISK_ACK_WAIT_MS = 2_000;

/** What the page knows from the acknowledgment read. */
export type RiskAckRead =
  /** The read answered: the acknowledged version, or null for none. */
  | { state: "answered"; version: string | null }
  /** The read failed and holds no earlier answer. */
  | { state: "failed" }
  /** The first read has not answered yet. */
  | { state: "pending" };

/** The read as react-query reports it (useQuery's `status` and `data`). */
export function riskAckReadFrom(
  status: "pending" | "error" | "success",
  data: string | null | undefined,
): RiskAckRead {
  // A refetch that failed keeps the last answer; that answer still holds.
  if (data !== undefined) return { state: "answered", version: data };
  if (status === "error") return { state: "failed" };
  if (status === "success") return { state: "answered", version: null };
  return { state: "pending" };
}

export type RiskAckTapPlan = { kind: "decided"; needsRiskAck: boolean } | { kind: "wait" };

/**
 * `needsAck(version)` is needsRiskAcknowledgment for this viewer. A viewer who
 * would not be asked even with no acknowledgment on file (host, already in,
 * signed out) never waits for the read.
 */
export function planRiskAckTap(
  read: RiskAckRead,
  needsAck: (acknowledgedVersion: string | null) => boolean,
): RiskAckTapPlan {
  if (!needsAck(null)) return { kind: "decided", needsRiskAck: false };
  if (read.state === "answered") return { kind: "decided", needsRiskAck: needsAck(read.version) };
  if (read.state === "failed") return { kind: "decided", needsRiskAck: true };
  return { kind: "wait" };
}

/**
 * Wait (at most `timeoutMs`) for the read `fetchAck` starts or joins, then
 * decide. A timeout or a failed read asks.
 */
export async function settleRiskAckTap(
  fetchAck: () => Promise<RiskAckRead>,
  needsAck: (acknowledgedVersion: string | null) => boolean,
  timeoutMs: number = RISK_ACK_WAIT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<RiskAckRead>((resolve) => {
    timer = setTimeout(() => resolve({ state: "failed" }), timeoutMs);
  });
  try {
    const read = await Promise.race([
      fetchAck().catch((): RiskAckRead => ({ state: "failed" })),
      timedOut,
    ]);
    const plan = planRiskAckTap(read.state === "pending" ? { state: "failed" } : read, needsAck);
    return plan.kind === "decided" ? plan.needsRiskAck : true;
  } finally {
    clearTimeout(timer);
  }
}
