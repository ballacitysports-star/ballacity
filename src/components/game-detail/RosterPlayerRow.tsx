import { Link, useNavigate } from "@tanstack/react-router";
import { describeMessagingError } from "@/lib/minor-messaging";
import {
  CANCELLED_CLAIM_REVIEW_MESSAGE,
  DECLINED_CLAIM_REVIEW_MESSAGE,
  rosterRowClaimStatus,
  type PaymentSubmissionStatus,
} from "@/lib/payment-states";
import {
  Clock,
  MessageCircle,
  Star,
  Check,
  Wallet,
  X as XIcon,
  History,
  BellRing,
} from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { computeReputation } from "@/lib/reviews";
import { useReviewsFor } from "@/lib/reviews-db";
import { subscribeGamePaymentChanges } from "@/lib/game-payment-channel";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import { reviewJoinRequest, getSignedProofUrl, type JoinRequest } from "@/lib/payments";
import { reviewPaymentAction } from "@/lib/payments.functions";
import { PAID_NOT_PLACED_MESSAGE } from "@/lib/payments-policy";
import { playAttentionPing } from "@/lib/attention-ping";
import { formatHoldRemaining, holdExpiresAt, useNow } from "@/lib/payment-hold";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { createNotification } from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { fetchProfileNameBits, withManagedProfileNames } from "@/lib/managed-profile-names";
import { blockPlayer } from "@/components/game-detail/game-player-actions";
import { errorText, paymentSubmissionErrorMessage, userErrorMessage } from "@/lib/user-error";

/** The sentences reviewPaymentAction words itself for a host; shown as they are (WP 4.0). */
const PAYMENT_REVIEW_SENTENCES: readonly string[] = [
  "Only this game's host can review its payments.",
  "This player isn't part of this game.",
  "Payment coordination isn't available for this account yet.",
  "Payment coordination isn't available for this player's account yet.",
  "No payment submission to update.",
  CANCELLED_CLAIM_REVIEW_MESSAGE,
  DECLINED_CLAIM_REVIEW_MESSAGE,
];

/** What a host sees when reviewing a payment fails: our own sentence, else the payment mapper's, never raw text. */
function paymentReviewErrorMessage(e: unknown): string {
  const text = errorText(e) ?? "";
  if (text.startsWith("Payment status changed since you loaded the page")) {
    return "This payment changed since you loaded the page. Refresh and try again.";
  }
  if (PAYMENT_REVIEW_SENTENCES.includes(text)) return text;
  return paymentSubmissionErrorMessage(e);
}

export function RosterPlayerRow({
  req,
  gameTitle,
  feeRequired,
  fee,
  holdMinutes,
  gameStartsAt,
  onOptimistic,
}: {
  req: JoinRequest;
  gameTitle: string;
  feeRequired: boolean;
  fee: number;
  holdMinutes: number | null;
  gameStartsAt: string;
  onOptimistic: (reqId: string, status: "approved" | "rejected") => () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const navigate = useNavigate();
  const [name, setName] = useState<string>("Player");
  const [initials, setInitials] = useState<string>("P");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [latestSub, setLatestSub] = useState<{
    id: string;
    status: PaymentSubmissionStatus;
    screenshot_path: string | null;
  } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<
    Array<{
      id: string;
      action: string;
      from_status: string | null;
      to_status: string | null;
      notes: string | null;
      actor_id: string | null;
      actor_name: string;
      created_at: string;
    }>
  >([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const paymentStatus: PaymentSubmissionStatus | "none" = latestSub?.status ?? "none";
  // Last status this row rendered, so a realtime flip to "pending" can alert
  // the host once (not on first load, and not on the host's own actions).
  const paymentStatusRef = useRef(paymentStatus);
  paymentStatusRef.current = paymentStatus;
  const nameRef = useRef(name);
  nameRef.current = name;
  const reviews = useReviewsFor(req.player_id);
  const rep = useMemo(() => computeReputation(reviews, "player"), [reviews]);
  const reliability = rep.criteriaAverages.find((c) => c.key === "reliability")?.avg ?? 0;
  const sportsmanship = rep.criteriaAverages.find((c) => c.key === "sportsmanship")?.avg ?? 0;

  useEffect(() => {
    let cancel = false;
    const loadPayment = async (fromRealtime = false) => {
      const { data } = await supabase
        .from("payment_submissions")
        .select("id, status, screenshot_path")
        .eq("game_id", req.game_id)
        .eq("player_id", req.player_id)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancel) return;
      const d = data as { id: string; status: string; screenshot_path: string | null } | null;
      // A cancelled claim keeps its own state: "Mark as paid" on it would be refused (DECISION_FINAL).
      const shown = rosterRowClaimStatus(d?.status);
      if (d && shown) {
        if (fromRealtime && d.status === "pending" && paymentStatusRef.current !== "pending") {
          playAttentionPing();
          toast.info(`${nameRef.current} sent payment proof`, {
            description: `${gameTitle} · tap View proof to confirm.`,
          });
        }
        setLatestSub({ id: d.id, status: shown, screenshot_path: d.screenshot_path });
      } else {
        setLatestSub(null);
      }
    };
    (async () => {
      // A block or a suspension hides the profile row; the host still has to tell whose
      // spot and payment proof this is, so the name is filled from managed_profile_names.
      const d = await fetchProfileNameBits(supabase, req.player_id);
      if (!cancel) {
        if (d) {
          const n = d.display_name ?? "Player";
          setName(n);
          setInitials((d.avatar_initials ?? n.slice(0, 2)).toUpperCase());
          setAvatarUrl(d.avatar_url ?? null);
        }
      }
      await loadPayment();
    })();

    // Realtime: update the paid chip as soon as this player's submission for this game
    // changes. One channel per game is shared by every roster row (P2-6).
    const unsubscribe = subscribeGamePaymentChanges(req.game_id, req.player_id, () =>
      loadPayment(true),
    );

    return () => {
      cancel = true;
      unsubscribe();
    };
  }, [req.player_id, req.game_id]);

  const setPaymentStatusAction = async (
    next: "verified" | "rejected" | "pending",
    notifyType?: "payment_verified" | "payment_rejected",
  ) => {
    if (!latestSub || busy) return;
    setBusy(true);
    const prev = latestSub;
    // Optimistic UI. `expectedFrom` gives server-side optimistic concurrency
    // so a second concurrent click cannot double-apply the transition.
    setLatestSub({ ...latestSub, status: next });
    try {
      const res = await reviewPaymentAction({
        data: {
          gameId: req.game_id,
          playerId: req.player_id,
          next,
          expectedFrom: prev.status,
        },
      });
      setLatestSub({
        id: res.submission.id,
        status: res.submission.status,
        screenshot_path: res.submission.screenshot_path,
      });
      if (!res.changed) {
        // Idempotent no-op — already in this state (duplicate click / stale tab).
        toast.info("Already up to date.");
        return;
      }
      if (next === "verified" && res.placed === false) {
        // The server told the player and the host that the place could not be given; don't say "all set".
        toast.warning(PAID_NOT_PLACED_MESSAGE);
        return;
      }
      if (notifyType) {
        await createNotification({
          user_id: req.player_id,
          type: notifyType,
          title:
            next === "verified"
              ? `Payment verified for ${gameTitle}`
              : `Payment rejected for ${gameTitle}`,
          body:
            next === "verified"
              ? "The host confirmed your payment. You're all set."
              : "The host couldn't verify your payment. Please resubmit.",
          link: `/games/${req.game_id}`,
        });
      }
      toast.success(
        next === "verified"
          ? "Payment verified."
          : next === "rejected"
            ? "Payment rejected."
            : "Marked unpaid.",
      );
    } catch (e: unknown) {
      setLatestSub(prev);
      toast.error(paymentReviewErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const markPaidNoSubmission = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await reviewPaymentAction({
        data: {
          gameId: req.game_id,
          playerId: req.player_id,
          next: "verified",
          expectedFrom: "none",
        },
      });
      setLatestSub({
        id: res.submission.id,
        status: res.submission.status,
        screenshot_path: res.submission.screenshot_path,
      });
      if (!res.changed) {
        toast.info("Already marked as paid.");
        return;
      }
      if (res.placed === false) {
        toast.warning(PAID_NOT_PLACED_MESSAGE);
        return;
      }
      await createNotification({
        user_id: req.player_id,
        type: "payment_verified",
        title: `Payment recorded for ${gameTitle}`,
        body: "The host marked your payment as received.",
        link: `/games/${req.game_id}`,
      });
      toast.success("Marked as paid.");
    } catch (e: unknown) {
      toast.error(paymentReviewErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const viewProof = async () => {
    if (!latestSub?.screenshot_path) return;
    const url = await getSignedProofUrl(latestSub.screenshot_path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else toast.error("Could not load proof.");
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from("payment_verification_events" as never)
        .select("id, action, from_status, to_status, notes, actor_id, created_at")
        .eq("game_id", req.game_id)
        .eq("player_id", req.player_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        id: string;
        action: string;
        from_status: string | null;
        to_status: string | null;
        notes: string | null;
        actor_id: string | null;
        created_at: string;
      }>;
      const actorIds = Array.from(
        new Set(rows.map((r) => r.actor_id).filter((v): v is string => !!v)),
      );
      const nameMap: Record<string, string> = {};
      if (actorIds.length) {
        const { data: read } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", actorIds);
        // The player's own entries keep their name when a block or suspension hides the row.
        const profs = await withManagedProfileNames(
          supabase,
          actorIds,
          (read ?? []) as Array<{ id: string; display_name: string | null }>,
        );
        for (const p of profs) {
          nameMap[p.id] = p.display_name ?? "Someone";
        }
      }
      setHistory(
        rows.map((r) => {
          const isHostActor = r.actor_id === req.host_id;
          const isPlayerActor = r.actor_id === req.player_id;
          const label = isHostActor
            ? "Host"
            : isPlayerActor
              ? "Player"
              : (r.actor_id && nameMap[r.actor_id]) || "System";
          return { ...r, actor_name: label };
        }),
      );
    } catch (e: unknown) {
      toast.error(userErrorMessage(e, "Couldn't load the payment history. Please try again."));
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && history.length === 0) void loadHistory();
  };

  // Refresh history after any local action changes the submission.
  useEffect(() => {
    if (historyOpen) void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestSub?.id, latestSub?.status]);

  const remove = async () => {
    if (!confirm(`Remove ${name} from ${gameTitle}?`)) return;
    setBusy(true);
    const rollback = onOptimistic(req.id, "rejected");
    try {
      await reviewJoinRequest(req.id, "rejected", "Removed by host", { removing: true });
      const { error: delErr } = await supabase
        .from("game_participants")
        .delete()
        .eq("game_id", req.game_id)
        .eq("user_id", req.player_id);
      if (delErr) throw delErr;
      await createNotification({
        user_id: req.player_id,
        type: "join_declined",
        title: `Removed from ${gameTitle}`,
        body: "The host removed you from this game.",
        link: `/games/${req.game_id}`,
      });
      toast.success(`${name} removed.`);
    } catch (e: unknown) {
      rollback();
      toast.error(userErrorMessage(e, "Couldn't remove this player. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const removeAndBlock = async () => {
    if (
      !confirm(
        `Remove ${name} from this game and block them? From now on they can't request a spot in your games, message you or follow you. You can unblock them any time under Settings → Blocked users.`,
      )
    )
      return;
    setBusy(true);
    const rollback = onOptimistic(req.id, "rejected");
    try {
      await reviewJoinRequest(req.id, "rejected", "Blocked by host", { removing: true });
      const { error: delErr } = await supabase
        .from("game_participants")
        .delete()
        .eq("game_id", req.game_id)
        .eq("user_id", req.player_id);
      if (delErr) throw delErr;
      await createNotification({
        user_id: req.player_id,
        type: "join_declined",
        title: `Removed from ${gameTitle}`,
        body: "The host removed you from this game.",
        link: `/games/${req.game_id}`,
      });
      await blockPlayer(req.player_id, name);
    } catch (e: unknown) {
      rollback();
      toast.error(userErrorMessage(e, "Couldn't block this player. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const remindToPay = async () => {
    if (reminding) return;
    setReminding(true);
    try {
      await createNotification({
        user_id: req.player_id,
        type: "payment_reminder",
        title: `Payment reminder · ${gameTitle}`.slice(0, 200),
        body: `Your $${fee} spot for ${gameTitle} is held. Tap here to pay the host.`,
        link: `/games/${req.game_id}/pay`,
      });
      toast.success(`Reminder sent to ${name}.`);
    } catch {
      toast.error("Couldn't send reminder.");
    } finally {
      setReminding(false);
    }
  };

  const messagePlayer = async () => {
    if (openingChat) return;
    setOpeningChat(true);
    try {
      const conversationId = await getOrCreateDirectConversation(req.player_id, req.game_id);
      const firstName = name.split(" ")[0] || name;
      // Pre-fill (never auto-send) a nudge matched to where they are in the flow.
      const draft = !feeRequired
        ? `Hey ${firstName}, you're approved for ${gameTitle}! See you there.`
        : paymentStatus === "verified"
          ? `Hey ${firstName}, your spot for ${gameTitle} is confirmed. See you there!`
          : paymentStatus === "pending"
            ? `Hey ${firstName}, got your payment proof for ${gameTitle} — confirming it now.`
            : `Hey ${firstName}, your spot is approved for ${gameTitle}! Please send your $${fee} fee to lock it in.`;
      navigate({
        to: "/messages/$conversationId",
        params: { conversationId },
        search: { draft },
      });
    } catch (e) {
      toast.error(describeMessagingError(e, undefined, "game_player"));
      setOpeningChat(false);
    }
  };

  const fmt = (n: number) => (n > 0 ? n.toFixed(1) : "—");
  // One stage badge instead of a green "Approved" pill next to a payment chip:
  // approval alone never reads as a confirmed, paid spot on fee games.
  const stageBadge = !feeRequired
    ? { label: "Approved", cls: "border-lime/40 bg-lime/10 text-lime", Icon: Check }
    : paymentStatus === "verified"
      ? { label: "Spot Confirmed (Paid)", cls: "border-lime/40 bg-lime/10 text-lime", Icon: Check }
      : paymentStatus === "pending"
        ? {
            label: "Proof sent · Awaiting host confirmation",
            cls: "border-sky-500/40 bg-sky-500/10 text-sky-500",
            Icon: Wallet,
          }
        : paymentStatus === "rejected"
          ? {
              label: "Payment declined by host · Resubmit proof or message host",
              cls: "border-coral/50 bg-coral/15 text-coral",
              Icon: Wallet,
            }
          : {
              label: "Approved · Awaiting Payment",
              cls: "border-amber-500/40 bg-amber-500/10 text-amber-500",
              Icon: Clock,
            };
  const canRemind =
    feeRequired &&
    (paymentStatus === "none" || paymentStatus === "rejected" || paymentStatus === "cancelled");
  const now = useNow();
  const holdExpires = canRemind
    ? holdExpiresAt({ approvedAt: req.reviewed_at, holdMinutes, gameStartsAt })
    : null;
  const holdMs = holdExpires ? holdExpires.getTime() - now : null;

  return (
    <div className="rounded-2xl border border-lime/30 bg-surface p-3">
      <div className="flex items-center gap-3">
        <Link to="/players/$userId" params={{ userId: req.player_id }} className="shrink-0">
          <UserAvatar
            name={name}
            initials={initials.slice(0, 2)}
            avatarUrl={avatarUrl}
            className="h-10 w-10 text-xs"
          />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{name}</div>
          <div className="text-[11px] text-muted-foreground">
            {rep.count > 0
              ? `${rep.count} review${rep.count === 1 ? "" : "s"} · trust ${rep.trustScore}`
              : "No reviews yet"}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={messagePlayer}
            disabled={openingChat}
            aria-label={`Message ${name}`}
            className="inline-flex items-center justify-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-bold hover:bg-secondary disabled:opacity-50"
          >
            <MessageCircle className="h-3.5 w-3.5" /> Message
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/10 px-3 py-1.5 text-xs font-bold text-coral disabled:opacity-50"
          >
            <XIcon className="h-3.5 w-3.5" /> Remove
          </button>
          <button
            type="button"
            onClick={removeAndBlock}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1 rounded-full border border-coral/60 bg-coral/20 px-3 py-1.5 text-xs font-bold text-coral disabled:opacity-50"
          >
            Block
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold">
          <Clock className="h-3 w-3 text-muted-foreground" />
          Reliability {fmt(reliability)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold">
          <Star className="h-3 w-3 text-muted-foreground" />
          Sportsmanship {fmt(sportsmanship)}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${stageBadge.cls}`}
        >
          <stageBadge.Icon className="h-3 w-3" /> {stageBadge.label}
        </span>
        {holdMs !== null && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-background px-2 py-0.5 text-[10px] font-bold text-amber-500 tabular-nums"
            title="The spot is released automatically if no payment arrives before the hold ends."
          >
            ⏳ {holdMs > 0 ? formatHoldRemaining(holdMs) : "Releasing spot…"}
          </span>
        )}
      </div>
      {feeRequired && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {canRemind && (
            <button
              type="button"
              onClick={remindToPay}
              disabled={reminding || busy}
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-500 disabled:opacity-50"
            >
              <BellRing className="h-3 w-3" /> Remind to Pay
            </button>
          )}
          {latestSub?.screenshot_path && (
            <button
              type="button"
              onClick={viewProof}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold hover:bg-secondary"
            >
              View proof
            </button>
          )}
          {paymentStatus === "pending" && (
            <>
              <button
                type="button"
                onClick={() => setPaymentStatusAction("verified", "payment_verified")}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-full border border-lime/50 bg-lime/15 px-2.5 py-1 text-[11px] font-bold text-lime disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Verify payment
              </button>
              <button
                type="button"
                onClick={() => setPaymentStatusAction("rejected", "payment_rejected")}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-full border border-coral/50 bg-coral/15 px-2.5 py-1 text-[11px] font-bold text-coral disabled:opacity-50"
              >
                <XIcon className="h-3 w-3" /> Reject
              </button>
            </>
          )}
          {paymentStatus === "rejected" && (
            // A declined payment is final for the host (DECISION_FINAL, 20261125100000): the player sends it again.
            <span className="text-[11px] text-muted-foreground">
              Declined. The player can send their payment again.
            </span>
          )}
          {paymentStatus === "cancelled" && (
            // A cancelled claim is final for the host too (DECISION_FINAL, 20261125100000): the player sends a new one.
            <span className="text-[11px] text-muted-foreground">
              Claim cancelled. The player can send their payment again.
            </span>
          )}
          {paymentStatus === "verified" && (
            <button
              type="button"
              onClick={() => setPaymentStatusAction("pending")}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold hover:bg-secondary disabled:opacity-50"
            >
              Mark unpaid
            </button>
          )}
          {paymentStatus === "none" && (
            <button
              type="button"
              onClick={markPaidNoSubmission}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-full border border-lime/50 bg-lime/15 px-2.5 py-1 text-[11px] font-bold text-lime disabled:opacity-50"
            >
              <Check className="h-3 w-3" /> Mark as paid
            </button>
          )}
          <button
            type="button"
            onClick={toggleHistory}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold hover:bg-secondary"
            aria-expanded={historyOpen}
          >
            <History className="h-3 w-3" /> {historyOpen ? "Hide history" : "History"}
          </button>
        </div>
      )}
      {feeRequired && historyOpen && (
        <div className="mt-2 rounded-xl border border-border bg-background/60 p-2.5">
          <div className="mb-1.5 micro-label text-muted-foreground">Verification history</div>
          {historyLoading ? (
            <div className="text-[11px] text-muted-foreground">Loading…</div>
          ) : history.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">No activity yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {history.map((ev) => {
                const when = new Date(ev.created_at).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });
                const change =
                  ev.from_status && ev.to_status
                    ? `${ev.from_status} → ${ev.to_status}`
                    : (ev.to_status ?? ev.action);
                const label =
                  ev.action === "submitted"
                    ? "Player submitted payment"
                    : ev.action === "created_verified"
                      ? "Host marked as paid"
                      : ev.action === "created_rejected"
                        ? "Marked rejected"
                        : ev.action === "verified"
                          ? "Payment verified"
                          : ev.action === "rejected"
                            ? "Payment rejected"
                            : ev.action === "reopened"
                              ? "Marked unpaid"
                              : "Updated";
                return (
                  <li
                    key={ev.id}
                    className="rounded-lg border border-border/60 bg-surface px-2 py-1.5 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{label}</span>
                      <span className="text-muted-foreground">{when}</span>
                    </div>
                    <div className="text-muted-foreground">
                      by {ev.actor_name} · {change}
                    </div>
                    {ev.notes && (
                      <div className="mt-0.5 italic text-muted-foreground">“{ev.notes}”</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
