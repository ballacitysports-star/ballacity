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
import {
  listMySubmissionsForGame,
  getSignedProofUrl,
  listPaymentMethodsForHost,
  paymentTypeMeta,
  type PaymentMethod,
  type PaymentSubmission,
  type GamePaymentSettings,
} from "@/lib/payments";
import { reviewPaymentAction } from "@/lib/payments.functions";
import { hostCancelPaymentSubmission } from "@/lib/payments";
import {
  CANCELLATION_REASON_LABELS,
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
import { PAYMENTS_BLOCKED_MESSAGE } from "@/lib/payments-policy";

type Filter = "all" | "pending" | "verified" | "rejected" | "disputed";

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
}: {
  gameId: string;
  settings: GamePaymentSettings | null;
  isHost: boolean;
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
                <div className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
                  Payment deadline
                </div>
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
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
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
                      {m.username && <span className="text-muted-foreground">· {m.username}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {settings?.payment_instructions && (
            <div className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
                <FileText className="h-3.5 w-3.5" /> Instructions
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{settings.payment_instructions}</p>
            </div>
          )}

          {settings?.refund_policy && (
            <div className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
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
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_initials, avatar_url")
          .in("id", ids);
        for (const p of (profs ?? []) as Array<{
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
      toast.error(e?.message ?? "Could not load payments.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`host_payments:${gameId}`)
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
      supabase.removeChannel(ch);
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
      if (!res.changed) toast.info("Already up to date.");
      else toast.success(next === "verified" ? "Payment verified." : "Payment declined.");
      if (res.changed) {
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
      toast.error(e?.message ?? "Could not update payment.");
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
      toast.error(e?.message ?? "Could not cancel this claim.");
    } finally {
      setBusyId(null);
    }
  };

  if (!paymentsGate.allowed) {
    return <PaymentsUnavailableCard reason={paymentsGate.reason} />;
  }

  return (
    <div className="space-y-4">
      <PaymentPoliciesCard gameId={gameId} settings={settings} isHost />
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
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Pending
            </div>
          </div>
          <div className="rounded-xl border border-lime/30 bg-lime/10 p-2">
            <div className="font-display text-lg font-bold text-lime">{counts.verified}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Verified
            </div>
          </div>
          <div className="rounded-xl border border-coral/40 bg-coral/10 p-2">
            <div className="font-display text-lg font-bold text-coral">{counts.rejected}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Declined
            </div>
          </div>
        </div>
        <p className="mt-3 rounded-xl border border-border bg-background p-2 text-[11px] text-muted-foreground">
          {PAYMENT_DISCLAIMER} Confirming here only marks the player paid in ballaCity — it does not
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
                  {canHostConfirm(
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
  const [subs, setSubs] = useState<PaymentSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const list = await listMySubmissionsForGame(gameId);
      setSubs(list);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load your payments.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    let uid: string | null = null;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data } = await supabase.auth.getUser();
      uid = data.user?.id ?? null;
      if (!uid) return;
      ch = supabase
        .channel(`my_payments:${gameId}:${uid}`)
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
      if (ch) supabase.removeChannel(ch);
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
      <PaymentPoliciesCard gameId={gameId} settings={settings} isHost={false} />
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
