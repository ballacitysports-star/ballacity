import { Link, useNavigate } from "@tanstack/react-router";
import { describeMessagingError } from "@/lib/minor-messaging";
import type { PaymentSubmissionStatus } from "@/lib/payment-states";
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
import { playAttentionPing } from "@/lib/attention-ping";
import { formatHoldRemaining, holdExpiresAt, useNow } from "@/lib/payment-hold";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { createNotification } from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { blockPlayer } from "@/components/game-detail/game-player-actions";

type ProfileBits = {
  display_name?: string | null;
  avatar_initials?: string | null;
  avatar_url?: string | null;
};

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
      if (d && (d.status === "verified" || d.status === "pending" || d.status === "rejected")) {
        if (fromRealtime && d.status === "pending" && paymentStatusRef.current !== "pending") {
          playAttentionPing();
          toast.info(`${nameRef.current} sent payment proof`, {
            description: `${gameTitle} · tap View proof to confirm.`,
          });
        }
        setLatestSub({ id: d.id, status: d.status, screenshot_path: d.screenshot_path });
      } else {
        setLatestSub(null);
      }
    };
    (async () => {
      const profRes = await supabase
        .from("profiles")
        .select("display_name, avatar_initials, avatar_url")
        .eq("id", req.player_id)
        .maybeSingle();
      if (!cancel) {
        const d = profRes.data as ProfileBits | null;
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
      toast.error((e as { message?: string } | null)?.message ?? "Could not update payment.");
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
      await createNotification({
        user_id: req.player_id,
        type: "payment_verified",
        title: `Payment recorded for ${gameTitle}`,
        body: "The host marked your payment as received.",
        link: `/games/${req.game_id}`,
      });
      toast.success("Marked as paid.");
    } catch (e: unknown) {
      toast.error((e as { message?: string } | null)?.message ?? "Could not mark as paid.");
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
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", actorIds);
        for (const p of (profs ?? []) as Array<{ id: string; display_name: string | null }>) {
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
      toast.error((e as { message?: string } | null)?.message ?? "Could not load history.");
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
      await reviewJoinRequest(req.id, "rejected", "Removed by host");
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
      toast.error((e as { message?: string } | null)?.message ?? "Could not remove.");
    } finally {
      setBusy(false);
    }
  };

  const removeAndBlock = async () => {
    if (
      !confirm(
        `Remove ${name} from this game and block them? From now on they can't ask to join your games, message you or follow you. You can unblock them any time under Settings → Blocked users.`,
      )
    )
      return;
    setBusy(true);
    const rollback = onOptimistic(req.id, "rejected");
    try {
      await reviewJoinRequest(req.id, "rejected", "Blocked by host");
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
      toast.error((e as { message?: string } | null)?.message ?? "Could not block.");
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
  const canRemind = feeRequired && (paymentStatus === "none" || paymentStatus === "rejected");
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
            <button
              type="button"
              onClick={() => setPaymentStatusAction("verified", "payment_verified")}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-full border border-lime/50 bg-lime/15 px-2.5 py-1 text-[11px] font-bold text-lime disabled:opacity-50"
            >
              <Check className="h-3 w-3" /> Verify anyway
            </button>
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
