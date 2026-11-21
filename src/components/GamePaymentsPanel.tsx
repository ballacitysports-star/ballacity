import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Check,
  X as XIcon,
  ExternalLink,
  RefreshCw,
  Clock,
  ShieldCheck,
  ImageIcon,
  CalendarClock,
  FileText,
  Info,
  Wallet,
  Pencil,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { withManagedProfileNames } from "@/lib/managed-profile-names";
import { getCurrentUserId } from "@/lib/current-user-id";
import {
  listMySubmissionsForGame,
  getSignedProofUrl,
  listPaymentMethodsForHost,
  paymentTypeMeta,
  type PaymentMethod,
  type PaymentSubmission,
  type GamePaymentSettings,
  markRefundSent,
} from "@/lib/payments";
import { reviewPaymentAction } from "@/lib/payments.functions";
import { hostCancelPaymentSubmission } from "@/lib/payments";
import {
  CANCELLATION_REASON_LABELS,
  CANCELLED_CLAIM_REVIEW_MESSAGE,
  DECLINED_CLAIM_REVIEW_MESSAGE,
  PAYMENT_DISCLAIMER,
  PAYMENT_STATE_META,
  canHostConfirm,
  cancellationReasonLabel,
  type CancellationReason,
} from "@/lib/payment-states";
import { PaymentSafetyNotice } from "@/components/PaymentSafetyNotice";
import { createNotification } from "@/lib/notifications";
import { UserAvatar } from "@/components/UserAvatar";
import { useMyChildStatus } from "@/lib/child-safety";
import {
  PAID_NOT_PLACED_MESSAGE,
  PAYMENTS_BLOCKED_MESSAGE,
  PAYMENT_SAVE_FAILED_MESSAGE,
} from "@/lib/payments-policy";
import { errorText, paymentSubmissionErrorMessage, userErrorMessage } from "@/lib/user-error";

/** The sentences reviewPaymentAction words itself for a host; shown as they are (WP 4.0). Same list as RosterPlayerRow. */
const PAYMENT_REVIEW_SENTENCES: readonly string[] = [
  "Only this game's host can review its payments.",
  "This player isn't part of this game.",
  "Payment coordination isn't available for this account yet.",
  "Payment coordination isn't available for this player's account yet.",
  "No payment submission to update.",
  CANCELLED_CLAIM_REVIEW_MESSAGE,
  DECLINED_CLAIM_REVIEW_MESSAGE,
];

/**
 * What a host sees when cancelling a claim or marking a refund sent fails: the payment mapper's words for a payment
 * refusal, else userErrorMessage with `fallback`, which names the action (not "couldn't save this payment").
 */
function hostPaymentActionErrorMessage(e: unknown, fallback: string): string {
  const mapped = paymentSubmissionErrorMessage(e);
  return mapped === PAYMENT_SAVE_FAILED_MESSAGE ? userErrorMessage(e, fallback) : mapped;
}

/** What a host sees when reviewing a payment fails: our own sentence, else the payment mapper's, never raw text. */
function paymentReviewErrorMessage(e: unknown): string {
  const text = errorText(e) ?? "";
  if (text.startsWith("Payment status changed since you loaded the page")) {
    return "This payment changed since you loaded the page. Refresh and try again.";
  }
  if (PAYMENT_REVIEW_SENTENCES.includes(text)) return text;
  return paymentSubmissionErrorMessage(e);
}
import { MANUAL_GUARDIAN_HOLD_MESSAGE } from "@/lib/pay-entry-gate";
import { useAuth } from "@/hooks/use-auth";
import { useGameManualClaimGuardianReady } from "@/hooks/use-game-payment-guardian-ready";

type Filter = "all" | "pending" | "verified" | "rejected" | "disputed";

let paymentsTopicSeq = 0;

/**
 * A realtime topic no channel in this tab has used yet (WP 4.3). supabase.channel() hands back the existing channel
 * when one with the same topic is still in its list, and a removed channel stays there until the server acknowledges
 * the leave. Reopening the Payments tab (or React's dev double mount) therefore got the old, already subscribed
 * channel back, and adding the postgres_changes listener to it threw "cannot add `postgres_changes` callbacks ...
 * after `subscribe()`". A fresh suffix per subscription means every mount gets its own channel. The topic name is not
 * an access control: Row Level Security decides which rows each subscriber receives.
 */
function freshPaymentsTopic(base: string): string {
  paymentsTopicSeq += 1;
  return `${base}:${paymentsTopicSeq}`;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function fmtMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `$${v.toFixed(2).replace(/\.00$/, "")}`;
}

function StatusPill({ status }: { status: PaymentSubmission["status"] }) {
  const cfg =
    status === "verified"
      ? { text: PAYMENT_STATE_META.confirmed.label, cls: "border-lime/40 bg-lime/15 text-lime" }
      : status === "rejected"
        ? { text: "Declined", cls: "border-coral/50 bg-coral/15 text-coral" }
        : status === "disputed"
          ? {
              text: PAYMENT_STATE_META.disputed.label,
              cls: "border-coral/50 bg-coral/15 text-coral",
            }
          : status === "cancelled"
            ? {
                text: PAYMENT_STATE_META.cancelled.label,
                cls: "border-border bg-background text-muted-foreground",
              }
            : {
                text: PAYMENT_STATE_META.host_confirmation_pending.label,
                cls: "border-amber-400/40 bg-amber-500/15 text-amber-500",
              };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cfg.cls}`}
    >
      {cfg.text}
    </span>
  );
}

async function openProof(path: string | null) {
  if (!path) {
    toast.info("No proof attached.");
    return;
  }
  const url = await getSignedProofUrl(path);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
  else toast.error("Could not load proof.");
}

/* --------------------------- Payment policies --------------------------- */

function fmtDeadline(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function PaymentPoliciesCard({
  gameId,
  settings,
  isHost,
  manualHandles = "show",
}: {
  gameId: string;
  settings: GamePaymentSettings | null;
  isHost: boolean;
  /**
   * Where to send a manual payment (the methods' handles and the host's payment instructions). A player's card shows
   * them only once game_manual_claim_guardian_ready says the database would take their manual claim: 'hide' while it
   * loads or failed, 'held' (hidden, with a line) when it said no (docs/paid-path-gates.md section 6 (d)).
   */
  manualHandles?: "show" | "hide" | "held";
}) {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!settings?.host_id) {
        setLoading(false);
        return;
      }
      try {
        const list = await listPaymentMethodsForHost(settings.host_id, gameId);
        if (cancelled) return;
        const accepted = new Set(settings.accepted_method_ids ?? []);
        const filtered = accepted.size
          ? list.filter((m) => accepted.has(m.id) && m.is_enabled)
          : list.filter((m) => m.is_enabled);
        setMethods(filtered);
      } catch {
        // silent; card still renders policies
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId, settings?.host_id, settings?.accepted_method_ids?.join(",")]);

  const deadline = settings?.payment_deadline ?? null;
  const isPastDue = !!deadline && new Date(deadline).getTime() < Date.now();
  const hasAny =
    !!deadline ||
    !!settings?.refund_policy ||
    !!settings?.payment_instructions ||
    methods.length > 0;
  const showHandles = manualHandles === "show";

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-base font-bold flex items-center gap-2">
            <Info className="h-4 w-4 text-lime" /> Payment details
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isHost
              ? "What players see on this game."
              : "Policies and accepted methods from the host."}
          </p>
        </div>
        {isHost && (
          <Link
            to="/games/$gameId/payment-setup"
            params={{ gameId }}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold hover:bg-secondary"
          >
            <Pencil className="h-3 w-3" /> Edit
          </Link>
        )}
      </div>

      {!hasAny ? (
        <div className="mt-3 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
          {isHost
            ? "No payment settings yet. Add a deadline, refund policy, or accepted methods."
            : "Host hasn't configured payment details yet."}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {deadline && (
            <div className="flex items-start gap-2 rounded-xl border border-border bg-background p-3">
              <CalendarClock
                className={`h-4 w-4 mt-0.5 shrink-0 ${isPastDue ? "text-coral" : "text-lime"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="micro-label text-muted-foreground">Payment deadline</div>
                <div className="text-sm font-semibold">{fmtDeadline(deadline)}</div>
                {isPastDue && (
                  <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-coral">
                    <AlertTriangle className="h-3 w-3" /> Past due
                  </div>
                )}
              </div>
            </div>
          )}

          {methods.length > 0 && (
            <div className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-center gap-2 micro-label text-muted-foreground">
                <Wallet className="h-3.5 w-3.5" /> Accepted methods
              </div>
              <ul className="mt-2 flex flex-wrap gap-2">
                {methods.map((m) => {
                  const meta = paymentTypeMeta(m.payment_type);
                  return (
                    <li
                      key={m.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs"
                    >
                      <span className="font-semibold">
                        {meta.emoji} {meta.name}
                      </span>
                      {showHandles && m.username && (
                        <span className="text-muted-foreground">· {m.username}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {manualHandles === "held" && methods.length > 0 && (
            <div
              className="rounded-xl border border-coral/40 bg-coral/10 p-3 text-xs text-muted-foreground"
              data-testid="payment-details-manual-held"
            >
              {MANUAL_GUARDIAN_HOLD_MESSAGE}
            </div>
          )}

          {showHandles && settings?.payment_instructions && (
            <div className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-center gap-2 micro-label text-muted-foreground">
                <FileText className="h-3.5 w-3.5" /> Instructions
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{settings.payment_instructions}</p>
            </div>
          )}

          {settings?.refund_policy && (
            <div className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-center gap-2 micro-label text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" /> Refund policy
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{settings.refund_policy}</p>
            </div>
          )}

          {loading && methods.length === 0 && (
            <div className="text-[11px] text-muted-foreground">Loading accepted methods…</div>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- Host --------------------------------- */

type HostRow = PaymentSubmission & {
  playerName: string;
  playerInitials: string;
  playerAvatarUrl: string | null;
};

/** Shown instead of payment UI when the member's cohort can't coordinate payments. */
function PaymentsUnavailableCard({ reason }: { reason?: string | null }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" /> Payments
      </div>
      <div className="mt-1 font-display text-lg font-bold">{PAYMENTS_BLOCKED_MESSAGE}</div>
      <p className="mt-1 text-xs text-muted-foreground">
        {reason ||
          "An adult account handles payment for this game. Ask a parent or guardian to take care of it for you."}
      </p>
    </div>
  );
}

export function HostPaymentsPanel({
  gameId,
  gameTitle,
  settings,
}: {
  gameId: string;
  gameTitle: string;
  settings: GamePaymentSettings | null;
}) {
  const { can: canFeature } = useMyChildStatus();
  const paymentsGate = canFeature("game_payments");
  const [rows, setRows] = useState<HostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      const { data, error } = await supabase
        .from("payment_submissions")
        .select("*")
        .eq("game_id", gameId)
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      const subs = (data ?? []) as PaymentSubmission[];
      const ids = Array.from(new Set(subs.map((s) => s.player_id)));
      const nameMap: Record<string, { n: string; i: string; a: string | null }> = {};
      if (ids.length) {
        const { data: read } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_initials, avatar_url")
          .in("id", ids);
        // A block or suspension hides the row; the host still needs the name.
        const profs = await withManagedProfileNames(supabase, ids, read);
        for (const p of profs as Array<{
          id: string;
          display_name: string | null;
          avatar_initials: string | null;
          avatar_url: string | null;
        }>) {
          nameMap[p.id] = {
            n: p.display_name ?? "Player",
            i: (p.avatar_initials ?? (p.display_name ?? "P").slice(0, 2)).toUpperCase(),
            a: p.avatar_url ?? null,
          };
        }
      }
      setRows(
        subs.map((s) => ({
          ...s,
          playerName: nameMap[s.player_id]?.n ?? "Player",
          playerInitials: nameMap[s.player_id]?.i ?? "P",
          playerAvatarUrl: nameMap[s.player_id]?.a ?? null,
        })),
      );
    } catch (e: any) {
      toast.error(userErrorMessage(e, "Couldn't load payments. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel(freshPaymentsTopic(`host_payments:${gameId}`))
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payment_submissions",
          filter: `game_id=eq.${gameId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const counts = useMemo(() => {
    const c = { pending: 0, verified: 0, rejected: 0, disputed: 0, cancelled: 0 };
    for (const r of rows) if (r.status in c) c[r.status as keyof typeof c]++;
    return c;
  }, [rows]);

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  const act = async (row: HostRow, next: "verified" | "rejected", reasonPrompt?: boolean) => {
    if (busyId) return;
    let reason: string | null = null;
    if (next === "rejected" && reasonPrompt) {
      const r = window.prompt("Reason for declining (optional)");
      if (r === null) return;
      reason = r.trim() || null;
    }
    setBusyId(row.id);
    // optimistic
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    try {
      const res = await reviewPaymentAction({
        data: { gameId: row.game_id, playerId: row.player_id, next, expectedFrom: row.status },
      });
      const notPlaced = next === "verified" && res.placed === false;
      if (!res.changed) toast.info("Already up to date.");
      else if (notPlaced) toast.warning(PAID_NOT_PLACED_MESSAGE);
      else toast.success(next === "verified" ? "Payment verified." : "Payment declined.");
      // A verified payment without a place: the server already told the player, so don't say "all set".
      if (res.changed && !notPlaced) {
        await createNotification({
          user_id: row.player_id,
          type: next === "verified" ? "payment_verified" : "payment_rejected",
          title:
            next === "verified"
              ? `Payment verified for ${gameTitle}`
              : `Payment declined for ${gameTitle}`,
          body:
            next === "verified"
              ? "The host confirmed your payment. You're all set."
              : reason || "The host couldn't verify your payment. Please resubmit.",
          link: `/games/${row.game_id}`,
        }).catch(() => {});
      }
    } catch (e: any) {
      // rollback
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)));
      toast.error(paymentReviewErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const hostCancel = async (row: HostRow) => {
    if (busyId) return;
    const options = Object.entries(CANCELLATION_REASON_LABELS)
      .map(([k, v], i) => `${i + 1}. ${v}`)
      .join("\n");
    const keys = Object.keys(CANCELLATION_REASON_LABELS) as CancellationReason[];
    const pick = window.prompt(`Why is this payment claim cancelled?\n${options}`, "1");
    if (pick === null) return;
    const reason = keys[Number(pick) - 1];
    if (!reason) {
      toast.error("Pick one of the listed reasons.");
      return;
    }
    setBusyId(row.id);
    try {
      await hostCancelPaymentSubmission(row.id, reason);
      toast.success("Payment claim cancelled.");
      await load();
    } catch (e: any) {
      toast.error(
        hostPaymentActionErrorMessage(e, "Couldn't cancel this payment claim. Please try again."),
      );
    } finally {
      setBusyId(null);
    }
  };

  if (!paymentsGate.allowed) {
    return <PaymentsUnavailableCard reason={paymentsGate.reason} />;
  }

  const refundRows = rows.filter(
    (r) => r.refund_status === "owed" || r.refund_status === "refunded",
  );
  const owedTotal = refundRows
    .filter((r) => r.refund_status === "owed")
    .reduce((n, r) => n + Number(r.refund_amount ?? 0), 0);

  const markRefunded = async (row: HostRow) => {
    setBusyId(row.id);
    try {
      await markRefundSent(row.id);
      toast.success(
        `Marked $${Number(row.refund_amount ?? 0).toFixed(2)} refunded to ${row.playerName}.`,
      );
      void load();
    } catch (e: unknown) {
      toast.error(
        hostPaymentActionErrorMessage(e, "Couldn't mark this refund as sent. Please try again."),
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <PaymentPoliciesCard gameId={gameId} settings={settings} isHost />
      {refundRows.length > 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="font-display text-base font-bold">Refunds</div>
            {owedTotal > 0 && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-500">
                ${owedTotal.toFixed(2)} owed
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Worked out from your refund policy. Send each one in your payment app, then mark it
            refunded so the player knows.
          </p>
          <ul className="mt-3 space-y-2">
            {refundRows.map((r) => (
              <li
                key={`refund-${r.id}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-background p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{r.playerName}</div>
                  <div className="text-[11px] text-muted-foreground">
                    ${Number(r.refund_amount ?? 0).toFixed(2)} ({r.refund_pct ?? 0}%) ·{" "}
                    {r.refund_reason === "game_cancelled"
                      ? "You cancelled the game"
                      : r.refund_reason === "no_show"
                        ? "No-show"
                        : "Player cancelled"}
                  </div>
                </div>
                {r.refund_status === "owed" ? (
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void markRefunded(r)}
                    className="shrink-0 rounded-full border border-lime/50 bg-lime/15 px-3 py-1.5 text-xs font-bold text-lime disabled:opacity-50"
                  >
                    Mark refunded
                  </button>
                ) : (
                  <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                    Refunded
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* Header */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-display text-base font-bold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-lime" /> Payment approvals
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Check your payment app, then confirm or decline each player's proof.
            </p>
          </div>
          <button
            type="button"
            onClick={() => load()}
            className="grid h-9 w-9 place-items-center rounded-full border border-border bg-background hover:bg-secondary"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-2">
            <div className="font-display text-lg font-bold text-amber-500">{counts.pending}</div>
            <div className="micro-label text-muted-foreground">Pending</div>
          </div>
          <div className="rounded-xl border border-lime/30 bg-lime/10 p-2">
            <div className="font-display text-lg font-bold text-lime">{counts.verified}</div>
            <div className="micro-label text-muted-foreground">Verified</div>
          </div>
          <div className="rounded-xl border border-coral/40 bg-coral/10 p-2">
            <div className="font-display text-lg font-bold text-coral">{counts.rejected}</div>
            <div className="micro-label text-muted-foreground">Declined</div>
          </div>
        </div>
        <p className="mt-3 rounded-xl border border-border bg-background p-2 text-[11px] text-muted-foreground">
          {PAYMENT_DISCLAIMER} Confirming here only marks the player paid in BallaCity — it does not
          move money.
        </p>
        {settings?.entry_fee != null && (
          <div className="mt-3 text-xs text-muted-foreground">
            Entry fee:{" "}
            <span className="font-semibold text-foreground">{fmtMoney(settings.entry_fee)}</span>
          </div>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-full border border-border bg-surface p-1 text-xs">
        {(["pending", "verified", "rejected", "disputed", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`flex-1 rounded-full px-3 py-1.5 font-semibold capitalize transition ${
              filter === f
                ? "bg-lime text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "all" ? "All" : f} {f !== "all" ? `· ${counts[f]}` : ""}
          </button>
        ))}
      </div>

      {/* Rows */}
      {loading ? (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Loading payments…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {filter === "pending"
            ? "No pending submissions. You're all caught up."
            : "No payment submissions in this filter."}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((row) => (
            <li
              key={row.id}
              className="rounded-2xl border border-border bg-surface p-3 flex flex-col gap-3"
            >
              <div className="flex items-start gap-3">
                <UserAvatar
                  size="md"
                  initials={row.playerInitials}
                  avatarUrl={row.playerAvatarUrl}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      to="/players/$userId"
                      params={{ userId: row.player_id }}
                      className="font-semibold truncate hover:underline"
                    >
                      {row.playerName}
                    </Link>
                    <StatusPill status={row.status} />
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {fmtWhen(row.submitted_at)}
                    </span>
                    {row.paid_amount != null && (
                      <span>
                        Amount:{" "}
                        <span className="font-semibold text-foreground">
                          {fmtMoney(row.paid_amount)}
                        </span>
                      </span>
                    )}
                    {row.payment_type && <span>via {row.payment_type}</span>}
                  </div>
                  {row.notes && (
                    <p className="mt-1 text-xs italic text-muted-foreground line-clamp-2">
                      "{row.notes}"
                    </p>
                  )}
                  {row.status === "disputed" && (
                    <p className="mt-1 text-[11px] font-semibold text-coral">
                      Disputed: {row.dispute_reason || "no reason given"} — resolve this directly
                      with the player in your payment app.
                    </p>
                  )}
                  {row.status === "cancelled" && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {cancellationReasonLabel(row.cancellation_reason)}
                    </p>
                  )}
                  {row.reviewer_notes && (
                    <p className="mt-1 text-[11px] text-coral">
                      Note to player: {row.reviewer_notes}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => openProof(row.screenshot_path)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
                >
                  {row.screenshot_path ? (
                    <>
                      <ImageIcon className="h-3.5 w-3.5" /> View proof
                    </>
                  ) : (
                    <>No proof attached</>
                  )}
                  {row.screenshot_path && <ExternalLink className="h-3 w-3" />}
                </button>
                <div className="ml-auto flex gap-2">
                  {/* A declined payment is final for the host (DECISION_FINAL, 20261125100000): the player sends it again. */}
                  {row.status !== "rejected" &&
                    canHostConfirm(
                      row.status === "verified"
                        ? "confirmed"
                        : row.status === "cancelled"
                          ? "cancelled"
                          : row.status === "disputed"
                            ? "disputed"
                            : "host_confirmation_pending",
                    ) && (
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => act(row, "verified")}
                        className="inline-flex items-center gap-1 rounded-full bg-lime px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60"
                      >
                        <Check className="h-3.5 w-3.5" /> Confirm received
                      </button>
                    )}
                  {row.status !== "rejected" && (
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => act(row, "rejected", true)}
                      className="inline-flex items-center gap-1 rounded-full border border-coral/60 bg-coral/10 px-3 py-1.5 text-xs font-bold text-coral disabled:opacity-60"
                    >
                      <XIcon className="h-3.5 w-3.5" /> Decline
                    </button>
                  )}
                  {row.status !== "cancelled" && row.status !== "verified" && (
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void hostCancel(row)}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground disabled:opacity-60"
                    >
                      Cancel claim
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------- Player -------------------------------- */

export function PlayerPaymentsPanel({
  gameId,
  settings,
}: {
  gameId: string;
  settings: GamePaymentSettings | null;
}) {
  const { can: canFeature } = useMyChildStatus();
  const paymentsGate = canFeature("game_payments");
  const { user } = useAuth();
  // The manual-claim trigger's guardian rule (section 6 (d)): no handles for a manual payment the database would refuse.
  const manualClaim = useGameManualClaimGuardianReady(gameId, user?.id ?? null, "payments-tab");
  const [subs, setSubs] = useState<PaymentSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const list = await listMySubmissionsForGame(gameId);
      setSubs(list);
    } catch (e: any) {
      toast.error(userErrorMessage(e, "Couldn't load your payments. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // The user id arrives after the effect returns. A cleanup that runs first (unmount, or a new game) must stop the
    // subscription from opening at all; before, it found no channel to remove and the late one leaked.
    let cancelled = false;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    void (async () => {
      const uid = await getCurrentUserId();
      if (cancelled || !uid) return;
      ch = supabase
        .channel(freshPaymentsTopic(`my_payments:${gameId}:${uid}`))
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "payment_submissions",
            filter: `player_id=eq.${uid}`,
          },
          (payload) => {
            const row = (payload.new ?? payload.old) as any;
            if (row?.game_id && row.game_id !== gameId) return;
            load();
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (ch) void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const latest = subs[0] ?? null;
  const fee = Number(settings?.entry_fee ?? 0);

  if (!paymentsGate.allowed) {
    return <PaymentsUnavailableCard reason={paymentsGate.reason} />;
  }

  return (
    <div className="space-y-4">
      <PaymentPoliciesCard
        gameId={gameId}
        settings={settings}
        isHost={false}
        manualHandles={
          manualClaim.data === true ? "show" : manualClaim.data === false ? "held" : "hide"
        }
      />
      {/* Status card */}

      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
          Your payment status
        </div>
        {loading ? (
          <div className="mt-2 text-sm text-muted-foreground">Loading…</div>
        ) : !latest ? (
          <>
            <div className="mt-1 font-display text-lg font-bold">Not submitted yet</div>
            <p className="text-xs text-muted-foreground mt-1">
              Send {fee > 0 ? fmtMoney(fee) : "payment"} to the host to lock in your spot.
            </p>
            <Link
              to="/games/$gameId/pay"
              params={{ gameId }}
              className="mt-3 inline-flex items-center rounded-full bg-lime-gradient px-4 py-2 text-sm font-bold text-primary-foreground"
            >
              Send payment proof
            </Link>
          </>
        ) : (
          <>
            <div className="mt-1 flex items-center gap-2">
              <StatusPill status={latest.status} />
              <span className="text-xs text-muted-foreground">{fmtWhen(latest.submitted_at)}</span>
            </div>
            <div className="mt-2 font-display text-lg font-bold">
              {latest.status === "verified"
                ? "Payment confirmed — you're locked in."
                : latest.status === "rejected"
                  ? "Payment declined"
                  : latest.status === "disputed"
                    ? PAYMENT_STATE_META.disputed.label
                    : latest.status === "cancelled"
                      ? cancellationReasonLabel(latest.cancellation_reason)
                      : PAYMENT_STATE_META.host_confirmation_pending.label}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {latest.status === "verified"
                ? `The host confirmed ${fmtMoney(latest.paid_amount ?? fee)}. See you at the game.`
                : latest.status === "rejected"
                  ? latest.reviewer_notes ||
                    "The host couldn't verify your last payment. Send new proof to lock your spot."
                  : latest.status === "disputed"
                    ? latest.dispute_reason || PAYMENT_STATE_META.disputed.playerHint
                    : latest.status === "cancelled"
                      ? PAYMENT_STATE_META.cancelled.playerHint
                      : PAYMENT_STATE_META.host_confirmation_pending.playerHint}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {latest.screenshot_path && (
                <button
                  type="button"
                  onClick={() => openProof(latest.screenshot_path)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
                >
                  <ImageIcon className="h-3.5 w-3.5" /> View my proof{" "}
                  <ExternalLink className="h-3 w-3" />
                </button>
              )}
              {(latest.status === "rejected" || latest.status === "pending") && (
                <Link
                  to="/games/$gameId/pay"
                  params={{ gameId }}
                  className="inline-flex items-center rounded-full bg-lime px-3 py-1.5 text-xs font-bold text-primary-foreground"
                >
                  {latest.status === "rejected" ? "Resubmit proof" : "Update proof"}
                </Link>
              )}
            </div>
          </>
        )}
      </div>

      <PaymentSafetyNotice
        counterpartyId={settings?.host_id ?? null}
        counterpartyLabel="this host"
        gameId={gameId}
      />

      {/* History */}
      {subs.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground mb-3">
            My history ({subs.length})
          </div>
          <ul className="space-y-2">
            {subs.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-background p-2.5"
              >
                <StatusPill status={s.status} />
                <div className="min-w-0 flex-1 text-xs">
                  <div className="font-semibold">
                    {s.paid_amount != null ? fmtMoney(s.paid_amount) : "—"}
                    {s.payment_type && (
                      <span className="text-muted-foreground"> · {s.payment_type}</span>
                    )}
                  </div>
                  <div className="text-muted-foreground">{fmtWhen(s.submitted_at)}</div>
                  {s.reviewer_notes && s.status === "rejected" && (
                    <div className="mt-0.5 text-[11px] text-coral">{s.reviewer_notes}</div>
                  )}
                </div>
                {s.screenshot_path && (
                  <button
                    type="button"
                    onClick={() => openProof(s.screenshot_path)}
                    className="rounded-full border border-border p-1.5 hover:bg-secondary"
                    title="View proof"
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
