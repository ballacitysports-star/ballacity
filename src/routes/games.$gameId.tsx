import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Share2,
  Bookmark,
  MapPin,
  Clock,
  Users,
  Calendar,
  MessageCircle,
  Star,
  Check,
  CreditCard,
  Settings as SettingsIcon,
  X as XIcon,
  Pencil,
  Play,
  Lock,
  Unlock,
} from "lucide-react";
import { GAMES, SPORTS } from "@/lib/sample-data";
import { formatWhen } from "@/lib/format";
import { ReviewsSection } from "@/components/ReviewsSection";
import { computeReputation, useReviewsFor } from "@/lib/reviews";
import { ReputationBadge } from "@/components/ReputationBadge";
import { joinGame, leaveGame, useIsJoined } from "@/lib/games-store";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import {
  getGamePaymentSettings,
  listMySubmissionsForGame,
  deleteMyPendingSubmission,
  getMyJoinRequest,
  createJoinRequest,
  cancelMyJoinRequest,
  listHostJoinRequests,
  reviewJoinRequest,
  upsertGamePaymentSettings,
  type GamePaymentSettings,
  type PaymentSubmission,
  type JoinRequest,
} from "@/lib/payments";
import { useHostedGames, updateHostedGame } from "@/lib/hosted-games-store";
import type { Game } from "@/lib/sample-data";
import { LegalNotice } from "@/components/LegalNotice";
import { useAuth } from "@/hooks/use-auth";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { createNotification } from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { useCanReview } from "@/lib/transactions";

const emojiBySport: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.name, s.emoji]),
);

const hostIdFor = (username: string) => `host-${username.replace(/^@/, "").toLowerCase()}`;

export const Route = createFileRoute("/games/$gameId")({
  validateSearch: (search: Record<string, unknown>) => {
    const out: { invite?: true; from?: string; exp?: number; expInvalid?: true } = {};
    if (search.invite === "1" || search.invite === 1 || search.invite === true) out.invite = true;
    if (typeof search.from === "string" && search.from.length > 0) out.from = search.from;
    const rawExp = search.exp;
    if (rawExp !== undefined && rawExp !== null && rawExp !== "") {
      const expNum =
        typeof rawExp === "number" ? rawExp : typeof rawExp === "string" ? Number(rawExp) : NaN;
      if (Number.isFinite(expNum) && expNum > 0) out.exp = expNum;
      else out.expInvalid = true;
    }
    return out;
  },

  loader: ({ params }) => {
    return { gameId: params.gameId };
  },
  head: ({ loaderData }) => {
    const game = loaderData ? GAMES.find((g) => g.id === loaderData.gameId) : undefined;
    return {
      meta: [
        { title: `${game?.title ?? "Game"} — OpenRun` },
        { name: "description", content: game?.description },
        { property: "og:image", content: game?.image },
      ],
    };
  },
  notFoundComponent: () => (
    <div className="min-h-dvh grid place-items-center px-6 text-center">
      <div>
        <h1 className="font-display text-3xl font-bold">Game not found</h1>
        <p className="text-muted-foreground mt-2">It may have wrapped up or been cancelled.</p>
        <Link
          to="/feed"
          className="inline-block mt-5 rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-primary-foreground"
        >
          Back to feed
        </Link>
      </div>
    </div>
  ),
  errorComponent: ({ reset }) => (
    <div className="min-h-dvh grid place-items-center px-6 text-center">
      <div>
        <h1 className="font-display text-2xl font-bold">Something went wrong</h1>
        <button
          onClick={reset}
          className="mt-4 rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  ),
  component: GameDetail,
});

function GameDetail() {
  const { gameId } = Route.useLoaderData();
  const { invite: isInvite, from: inviteFrom, exp: inviteExp, expInvalid } = Route.useSearch();
  const inviteExpired = !!(isInvite && ((inviteExp && inviteExp < Date.now()) || expInvalid));

  const hosted = useHostedGames();
  const game = useMemo<Game | undefined>(
    () => hosted.find((g) => g.id === gameId) ?? GAMES.find((g) => g.id === gameId),
    [hosted, gameId],
  );
  const joined = useIsJoined(gameId);
  const nav = useNavigate();
  const { user } = useAuth();
  const [settings, setSettings] = useState<GamePaymentSettings | null>(null);
  const [mySubs, setMySubs] = useState<PaymentSubmission[]>([]);
  const [myReq, setMyReq] = useState<JoinRequest | null>(null);
  const [hostRequests, setHostRequests] = useState<JoinRequest[]>([]);
  const [messaging, setMessaging] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);

  // effectiveJoined is computed below, after settings/myReq/isHost resolve.
  // Placeholder removed — see definition near line 161.
  // Ownership is locked to the original host's auth user id.
  // DB host_id (from game_payment_settings) is the source of truth; we also
  // accept the locally-stored hostUserId stamped at publish time (or by the
  // one-shot legacy migration in runLegacyHostMigration).
  const ownsViaDb = !!(user && settings && user.id === settings.host_id);
  const ownsViaGame = !!(user && game?.hostUserId && user.id === game.hostUserId);
  const hostsThisGame = ownsViaDb || ownsViaGame;
  const isHost = hostsThisGame;
  const [approvalSaving, setApprovalSaving] = useState(false);

  const hostReviews = useReviewsFor(hostIdFor(game?.host.username ?? ""));
  const hostRep = useMemo(() => computeReputation(hostReviews, "host"), [hostReviews]);
  const canReviewHost = useCanReview(hostIdFor(game?.host.username ?? ""));

  const refreshStatus = async () => {
    if (!game) return;
    try {
      const [s, subs, req] = await Promise.all([
        getGamePaymentSettings(game.id),
        listMySubmissionsForGame(game.id),
        getMyJoinRequest(game.id),
      ]);
      setSettings(s);
      setMySubs(subs);
      setMyReq(req);
      // Auto-join locally only when there's nothing left to pay. Otherwise the
      // Join CTA would flip to "leave" and hide the Pay flow after approval.
      const feeOwed = Number(s?.entry_fee ?? game.price ?? 0) > 0;
      const paidOk = subs[0]?.status === "verified";
      if (req?.status === "approved" && !joined && (!feeOwed || paidOk)) joinGame(game.id);
    } catch {}
  };

  const refreshHostRequests = async () => {
    if (!game || !user) return;
    if (!hostsThisGame && (!settings || user.id !== settings.host_id)) return;
    try {
      const all = await listHostJoinRequests();
      setHostRequests(all.filter((r) => r.game_id === game.id));
    } catch {}
  };

  const toggleRequireApproval = async () => {
    if (!game || !user) return;
    setApprovalSaving(true);
    try {
      await upsertGamePaymentSettings({
        game_id: game.id,
        entry_fee: Number(settings?.entry_fee ?? game.price ?? 0),
        accepted_method_ids: settings?.accepted_method_ids ?? [],
        payment_deadline: settings?.payment_deadline ?? null,
        refund_policy: settings?.refund_policy ?? null,
        payment_instructions: settings?.payment_instructions ?? null,
        requires_approval: !settings?.requires_approval,
      });
      toast.success(settings?.requires_approval ? "Approval disabled" : "Approval enabled");
      await refreshStatus();
      await refreshHostRequests();
    } catch (e: any) {
      toast.error(e.message ?? "Could not update.");
    } finally {
      setApprovalSaving(false);
    }
  };

  useEffect(() => {
    refreshStatus(); /* eslint-disable-next-line */
  }, [game?.id]);
  useEffect(() => {
    refreshHostRequests();
  }, [game?.id, user?.id, settings?.host_id, hostsThisGame]);

  // Realtime: refresh roster/requests when any join_request for this game changes.
  useEffect(() => {
    if (!game?.id || !hostsThisGame) return;
    const channel = supabase
      .channel(`join_requests:${game.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "join_requests", filter: `game_id=eq.${game.id}` },
        () => {
          refreshHostRequests();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line
  }, [game?.id, hostsThisGame]);

  if (!game) {
    return (
      <div className="min-h-dvh grid place-items-center px-6 text-center">
        <div>
          <h1 className="font-display text-3xl font-bold">Game not found</h1>
          <p className="text-muted-foreground mt-2">It may have wrapped up or been cancelled.</p>
          <Link
            to="/feed"
            className="inline-block mt-5 rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-primary-foreground"
          >
            Back to feed
          </Link>
        </div>
      </div>
    );
  }

  const fee = Number(settings?.entry_fee ?? game.price);
  const isPaid = fee > 0;
  const requiresApproval = !!settings?.requires_approval;
  const latestSub = mySubs[0];
  const isApproved = myReq?.status === "approved";
  const isRequestPending = myReq?.status === "pending";
  const isPaymentVerified = latestSub?.status === "verified";
  const isPaymentPending = latestSub?.status === "pending";
  // Approval-gated games treat approval as the *first* gate. Payment (if any)
  // becomes actionable only after the host approves the request.
  const approvalCleared = !requiresApproval || isApproved;
  const paymentCleared = !isPaid || isPaymentVerified;
  const isConfirmed =
    approvalCleared && paymentCleared && (requiresApproval || isPaid ? true : false);
  // Only surface "payment pending" once approval is cleared, so players
  // don't see a payment-pending state before they've been approved.
  const isPending = isRequestPending || (approvalCleared && isPaymentPending);

  // The viewer counts as a roster player only when:
  //  - they're not the host (hosts run the game, they don't take a player slot), AND
  //  - either there's no approval gate and they've joined locally, OR
  //    the host has confirmed/approved them (paid-verified or approved request).
  const viewerCountsAsJoined = !isHost && (isConfirmed || (joined && !requiresApproval && !isPaid));
  const effectiveJoined = (game.joined ?? 0) + (viewerCountsAsJoined ? 1 : 0);
  const spotsLeft = Math.max(0, game.maxPlayers - effectiveJoined);

  const handleJoin = async () => {
    // Expired invite → block all join actions and steer to discovery.
    if (inviteExpired && !isHost && !viewerCountsAsJoined && !viewerPending) {
      toast.error("This invite has expired. Browse open games instead.");
      nav({ to: "/discover" });
      return;
    }
    // Approved-but-unpaid on a paid game → route to pay page (don't treat as
    // "confirmed → leave" if a prior auto-join left `joined` stale-true).
    if (isPaid && !paymentCleared && !isPending && (isApproved || !requiresApproval)) {
      const search: { invite?: true; from?: string } = {};
      if (isInvite) search.invite = true;
      if (inviteFrom) search.from = inviteFrom;
      setRequesting(true);
      nav({ to: "/games/$gameId/pay", params: { gameId: game.id }, search });
      return;
    }
    // Confirmed → leave / withdraw
    if (isConfirmed || joined) {
      try {
        if (latestSub && latestSub.status !== "rejected") {
          await deleteMyPendingSubmission(latestSub.id).catch(() => {});
        }
        if (myReq && myReq.status === "pending") {
          await cancelMyJoinRequest(game.id).catch(() => {});
        }
        leaveGame(game.id);
        toast("You left the game.");
        refreshStatus();
      } catch (e: any) {
        toast.error(e.message ?? "Could not leave.");
      }
      return;
    }
    // Pending → cancel request / withdraw submission
    if (isPending) {
      try {
        if (latestSub?.status === "pending") await deleteMyPendingSubmission(latestSub.id);
        if (myReq?.status === "pending") await cancelMyJoinRequest(game.id);
        toast("Request canceled.");
        refreshStatus();
      } catch (e: any) {
        toast.error(e.message ?? "Could not cancel.");
      }
      return;
    }
    if (game.status === "in_progress") {
      toast.error("This game has already started.");
      return;
    }
    if (game.status === "completed") {
      toast.error("This game has ended.");
      return;
    }
    if (game.joinsClosed) {
      toast.error("The host has closed joining for this game.");
      return;
    }
    if (spotsLeft <= 0) {
      toast.error("This game is full.");
      return;
    }
    // Approval gate takes priority over payment: on games that require
    // approval, players must be approved before they can pay.
    if (requiresApproval && !isApproved) {
      if (!settings) {
        toast.error("Host hasn't enabled approvals yet.");
        return;
      }
      // Invite-link integrity: if the URL claims invite=1, `from` must be present
      // and must match the actual host. Otherwise the link is missing context or
      // has been tampered with — refuse to send the request.
      if (isInvite && (!inviteFrom || inviteFrom !== settings.host_id)) {
        toast.error("This invite link is invalid or has been tampered with.");
        return;
      }
      try {
        await createJoinRequest({ game_id: game.id, host_id: settings.host_id });
        await createNotification({
          user_id: settings.host_id,
          type: "join_request",
          title: `New request to join ${game.title}`,
          body: "Tap to review.",
          link: `/games/${game.id}`,
        });
        toast.success("Request sent. The host will review it.");
        refreshStatus();
      } catch (e: any) {
        toast.error(e.message ?? "Could not send request.");
      }
      return;
    }
    if (isPaid) {
      const search: { invite?: true; from?: string } = {};
      if (isInvite) search.invite = true;
      if (inviteFrom) search.from = inviteFrom;
      nav({ to: "/games/$gameId/pay", params: { gameId: game.id }, search });
      return;
    }
    joinGame(game.id);
    toast.success(`You're in! See you at ${game.location}.`);
  };

  const viewerPending =
    !isHost && requiresApproval && myReq?.status === "pending" && !viewerCountsAsJoined;
  const hostPendingReqs = isHost ? hostRequests.filter((r) => r.status === "pending") : [];
  const pendingCount = hostPendingReqs.length;
  type RosterEntry =
    | { kind: "player"; initials: string; isMe: boolean; pending: false }
    | { kind: "viewerPending"; initials: "YOU"; isMe: true; pending: true }
    | { kind: "hostPending"; req: JoinRequest; pending: true };
  const players: RosterEntry[] = [
    ...(viewerCountsAsJoined
      ? [{ kind: "player" as const, initials: "YOU", isMe: true, pending: false as const }]
      : []),
    ...Array.from({ length: game.joined }, (_, i) => ({
      kind: "player" as const,
      initials: ["MC", "AG", "JK", "RC", "TB", "SO", "PN", "DP", "EL", "VM"][i % 10],
      isMe: false,
      pending: false as const,
    })),
    ...(viewerPending
      ? [
          {
            kind: "viewerPending" as const,
            initials: "YOU" as const,
            isMe: true as const,
            pending: true as const,
          },
        ]
      : []),
    ...hostPendingReqs.map((r) => ({
      kind: "hostPending" as const,
      req: r,
      pending: true as const,
    })),
  ];

  return (
    <div className="pb-32">
      {/* Hero */}
      <div className="relative h-72">
        <img src={game.image} alt={game.title} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-background/40" />
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
          <Link
            to="/feed"
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex gap-2">
            <button className="grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur">
              <Bookmark className="h-4 w-4" />
            </button>
            <button className="grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur">
              <Share2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="absolute bottom-4 left-4 right-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-background/70 backdrop-blur px-3 py-1 text-xs font-semibold">
              {emojiBySport[game.sport]} {game.sport}
            </span>
            <span className="rounded-full bg-background/70 backdrop-blur px-3 py-1 text-xs font-semibold">
              {game.skill}
            </span>
            {game.urgent && (
              <span className="rounded-full bg-coral-gradient px-3 py-1 text-xs font-bold text-white">
                ⚡ {spotsLeft} spots left
              </span>
            )}
          </div>
          <h1 className="font-display text-3xl font-bold drop-shadow-lg">{game.title}</h1>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4 mt-5 space-y-5">
        {/* Invite deep-link banner */}
        {isInvite &&
          !isHost &&
          !viewerCountsAsJoined &&
          !viewerPending &&
          (inviteExpired ? (
            <div
              className="rounded-2xl border border-coral/50 bg-coral/10 p-4 flex items-start gap-3"
              role="status"
              aria-live="polite"
              data-testid="invite-expired-banner"
            >
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-coral/20 text-coral">
                ⏰
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display text-sm font-bold">Invite expired</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  This invitation is no longer valid. Browse other open games to find a run near
                  you.
                </p>
                <Link
                  to="/discover"
                  className="mt-3 inline-flex items-center rounded-full bg-lime-gradient px-4 py-1.5 text-xs font-bold text-primary-foreground"
                >
                  Browse open games
                </Link>
              </div>
            </div>
          ) : (
            <div
              className="rounded-2xl border border-lime/40 bg-lime/10 p-4 flex items-start gap-3"
              role="status"
            >
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-lime/20 text-lime">
                🎟️
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display text-sm font-bold">You're invited to this game</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The host invited you personally{inviteFrom ? "" : ""}. Tap{" "}
                  {requiresApproval ? "“Request to join”" : isPaid ? "“Pay & join”" : "“Join”"}{" "}
                  below to confirm your spot.
                </p>
              </div>
            </div>
          ))}

        {/* Approval status banner (player view) */}
        {!isHost && requiresApproval && myReq && (
          <div
            className={`rounded-2xl border p-4 flex items-start gap-3 ${
              myReq.status === "pending"
                ? "border-coral/40 bg-coral/10"
                : myReq.status === "approved"
                  ? "border-lime/40 bg-lime/10"
                  : "border-border bg-surface"
            }`}
            role="status"
            aria-live="polite"
          >
            {myReq.status === "pending" ? (
              <Clock className="h-5 w-5 text-coral shrink-0 mt-0.5" />
            ) : myReq.status === "approved" ? (
              <Check className="h-5 w-5 text-lime shrink-0 mt-0.5" />
            ) : (
              <XIcon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <div className="font-display text-sm font-bold">
                {myReq.status === "pending"
                  ? "Waiting for host approval"
                  : myReq.status === "approved"
                    ? "You're approved — see you there!"
                    : "Request declined"}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {myReq.status === "pending"
                  ? "Your spot isn't held until the host approves. You'll get a notification when they respond."
                  : myReq.status === "approved"
                    ? "The host approved your request. You're on the roster."
                    : myReq.reviewer_notes ||
                      "The host declined this request. You can message them or find another run."}
              </p>
            </div>
          </div>
        )}

        {/* Meta */}
        <div className="grid grid-cols-2 gap-2">
          <Meta
            icon={<Clock className="h-4 w-4 text-lime" />}
            label="Starts"
            value={formatWhen(game.date)}
          />
          <Meta
            icon={<Calendar className="h-4 w-4 text-lime" />}
            label="Duration"
            value={game.duration}
          />
          <Meta
            icon={<Users className="h-4 w-4 text-coral" />}
            label="Players"
            value={`${effectiveJoined} / ${game.maxPlayers}`}
          />
          <Meta
            icon={<MapPin className="h-4 w-4 text-coral" />}
            label="Distance"
            value={`${game.distanceMi} mi`}
          />
        </div>

        {/* Location card */}
        <div className="rounded-3xl border border-border bg-surface overflow-hidden">
          <div
            className="h-32 relative"
            style={{
              background:
                "radial-gradient(50% 60% at 50% 50%, oklch(0.30 0.08 145 / 0.5), transparent 60%), linear-gradient(180deg, oklch(0.18 0.03 240), oklch(0.14 0.03 250))",
            }}
          >
            <svg className="absolute inset-0 h-full w-full opacity-30" aria-hidden>
              <defs>
                <pattern id="g2" width="32" height="32" patternUnits="userSpaceOnUse">
                  <path
                    d="M 32 0 L 0 0 0 32"
                    fill="none"
                    stroke="oklch(1 0 0 / 0.1)"
                    strokeWidth="1"
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#g2)" />
            </svg>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid h-12 w-12 place-items-center rounded-full bg-lime text-primary-foreground glow-lime">
              <MapPin className="h-5 w-5" />
            </div>
          </div>
          <div className="p-4">
            <div className="font-semibold">{game.location}</div>
            <div className="text-sm text-muted-foreground">
              {game.neighborhood} · {game.indoor ? "Indoor" : "Outdoor"}
            </div>
          </div>
        </div>

        {/* Host */}
        <div className="flex items-center gap-3 rounded-3xl border border-border bg-surface p-4">
          {(() => {
            const hostId = settings?.host_id ?? game.hostUserId;
            const AvatarTag: any = hostId ? Link : "div";
            const avatarProps = hostId
              ? { to: "/players/$userId", params: { userId: hostId } }
              : {};
            const NameTag: any = hostId ? Link : "span";
            const nameProps = hostId
              ? {
                  to: "/players/$userId",
                  params: { userId: hostId },
                  className: "hover:text-lime hover:underline",
                }
              : {};
            return (
              <>
                <AvatarTag
                  {...avatarProps}
                  className="grid h-12 w-12 place-items-center rounded-2xl bg-lime-gradient font-bold text-primary-foreground"
                >
                  {game.host.avatar}
                </AvatarTag>
                <div className="flex-1">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Hosted by
                  </div>
                  <div className="font-semibold">
                    <NameTag {...nameProps}>{game.host.name}</NameTag>{" "}
                    <span className="text-muted-foreground font-normal text-sm">
                      {game.host.username}
                    </span>
                  </div>
                  <div className="text-xs text-lime font-semibold">
                    ★ {game.host.rating} host rating
                  </div>
                </div>
              </>
            );
          })()}
          {canReviewHost ? (
            <Link
              to="/review/new"
              search={
                {
                  revieweeId: hostIdFor(game.host.username),
                  revieweeKind: "host",
                  revieweeName: game.host.name,
                  kind: "player",
                  context: game.title,
                } as any
              }
              className="inline-flex items-center gap-1 rounded-full border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-bold text-lime"
            >
              <Star className="h-3 w-3" /> Write review
            </Link>
          ) : null}
        </div>

        {/* Host reputation (above the fold) */}
        {hostRep.count > 0 && (
          <div className="mt-3">
            <ReputationBadge rep={hostRep} />
          </div>
        )}

        {/* Host reviews */}
        <ReviewsSection
          revieweeId={hostIdFor(game.host.username)}
          revieweeKind="host"
          revieweeName={game.host.name}
        />

        {/* About */}
        <div>
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
            About the run
          </h2>
          <p className="text-sm leading-relaxed">{game.description}</p>
          {game.equipment.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {game.equipment.map((e: string) => (
                <span
                  key={e}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-xs"
                >
                  {e}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Players */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Roster ({effectiveJoined}/{game.maxPlayers})
              {(viewerPending || pendingCount > 0) && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/10 px-2 py-0.5 text-[10px] font-bold text-coral normal-case tracking-normal">
                  <Clock className="h-3 w-3" />
                  {viewerPending ? "You're pending" : `${pendingCount} pending`}
                </span>
              )}
            </h2>
            <button className="text-xs font-semibold text-lime">See all</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {players.map((p, i) => {
              if (p.kind === "hostPending") {
                return (
                  <HostPendingChip
                    key={`pending-${p.req.id}`}
                    req={p.req}
                    gameTitle={game.title}
                    onChange={() => {
                      refreshHostRequests();
                      refreshStatus();
                    }}
                    index={i}
                  />
                );
              }
              return (
                <motion.div
                  key={i}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: i * 0.04 }}
                  title={p.pending ? "Pending host approval" : undefined}
                  className={`relative grid h-11 w-11 place-items-center rounded-full border text-xs font-bold ${
                    p.pending
                      ? "border-dashed border-coral/60 bg-coral/10 text-coral"
                      : p.isMe
                        ? "border-lime bg-lime/15 text-lime"
                        : "border-border bg-surface"
                  }`}
                >
                  {p.initials}
                  {p.pending && (
                    <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-coral text-[8px] text-white">
                      <Clock className="h-2.5 w-2.5" />
                    </span>
                  )}
                </motion.div>
              );
            })}
            {Array.from({
              length: Math.max(0, spotsLeft - (viewerPending ? 1 : 0) - pendingCount),
            }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="grid h-11 w-11 place-items-center rounded-full border-2 border-dashed border-border bg-transparent text-muted-foreground text-lg"
              >
                +
              </div>
            ))}
          </div>
          {(viewerPending || pendingCount > 0) && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {isHost && pendingCount > 0
                ? "Tap a dashed coral avatar to approve or decline that pickup request."
                : "Dashed coral avatars = awaiting host approval. They don't hold a confirmed spot until approved."}
            </p>
          )}
        </div>
      </div>

      {/* Host controls */}
      {isHost && (
        <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4 mt-4 space-y-3">
          {/* Manage game: edit, start, close joining */}
          <div className="rounded-2xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-sm">Manage game</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {game.status === "in_progress"
                    ? "In progress — joining locked."
                    : game.status === "completed"
                      ? "This game has ended."
                      : game.joinsClosed
                        ? "Joining is closed. Reopen to accept more players."
                        : "Edit details, start the game, or close joining when full."}
                </p>
              </div>
              <span
                className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  game.status === "in_progress"
                    ? "bg-coral/15 text-coral border border-coral/40"
                    : game.status === "completed"
                      ? "bg-secondary text-muted-foreground border border-border"
                      : "bg-lime/15 text-lime border border-lime/40"
                }`}
              >
                {game.status === "in_progress"
                  ? "Live"
                  : game.status === "completed"
                    ? "Ended"
                    : "Scheduled"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                disabled={game.status === "completed"}
                className="inline-flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-background py-2.5 text-xs font-semibold disabled:opacity-50"
              >
                <Pencil className="h-4 w-4" /> Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  if (game.status === "in_progress") {
                    updateHostedGame(game.id, { status: "completed" });
                    toast.success("Game marked as ended.");
                  } else {
                    updateHostedGame(game.id, { status: "in_progress", joinsClosed: true });
                    toast.success("Game started. Have fun!");
                  }
                }}
                disabled={game.status === "completed"}
                className="inline-flex flex-col items-center justify-center gap-1 rounded-xl border border-lime/40 bg-lime/10 text-lime py-2.5 text-xs font-bold disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                {game.status === "in_progress" ? "End game" : "Start game"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !game.joinsClosed;
                  updateHostedGame(game.id, { joinsClosed: next });
                  toast.success(next ? "Joining closed." : "Joining reopened.");
                }}
                disabled={game.status !== "scheduled" && game.status !== undefined}
                className="inline-flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-background py-2.5 text-xs font-semibold disabled:opacity-50"
              >
                {game.joinsClosed ? (
                  <>
                    <Unlock className="h-4 w-4" /> Reopen
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" /> Close joins
                  </>
                )}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleRequireApproval}
            disabled={approvalSaving}
            className={`w-full flex items-center justify-between gap-3 rounded-2xl border p-4 text-left disabled:opacity-60 ${
              settings?.requires_approval ? "border-lime bg-lime/5" : "border-border bg-surface"
            }`}
          >
            <div className="min-w-0">
              <div className="font-semibold text-sm">Require my approval to join</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Players send a pickup request and you approve or decline each one.
              </p>
            </div>
            <div
              className={`shrink-0 grid h-7 w-12 items-center rounded-full p-0.5 transition-colors ${settings?.requires_approval ? "bg-lime" : "bg-secondary"}`}
            >
              <div
                className={`h-6 w-6 rounded-full bg-background shadow transition-transform ${settings?.requires_approval ? "translate-x-5" : ""}`}
              />
            </div>
          </button>

          {hostRequests.length > 0 ? (
            <div>
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Pickup requests · {hostRequests.filter((r) => r.status === "pending").length}{" "}
                pending
              </h2>
              <div className="space-y-2">
                {hostRequests.map((r) => (
                  <HostRequestRow
                    key={r.id}
                    req={r}
                    gameTitle={game.title}
                    onChange={refreshHostRequests}
                  />
                ))}
              </div>
            </div>
          ) : settings?.requires_approval ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-3 text-xs text-muted-foreground">
              No pickup requests yet. You'll see them here as players ask to join.
            </div>
          ) : null}

          {/* Roster (host view) */}
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Roster · {hostRequests.filter((r) => r.status === "approved").length + game.joined} /{" "}
              {game.maxPlayers}
            </h2>
            <div className="space-y-2">
              {hostRequests.filter((r) => r.status === "approved").length === 0 &&
              game.joined === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-3 text-xs text-muted-foreground">
                  No confirmed players yet.
                </div>
              ) : (
                <>
                  {hostRequests
                    .filter((r) => r.status === "approved")
                    .map((r) => (
                      <RosterPlayerRow
                        key={r.id}
                        req={r}
                        gameTitle={game.title}
                        feeRequired={isPaid}
                        onChange={refreshHostRequests}
                      />
                    ))}
                  {Array.from({ length: game.joined }).map((_, i) => (
                    <div
                      key={`ph-${i}`}
                      className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3"
                    >
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-xs font-bold">
                        {["MC", "AG", "JK", "RC", "TB", "SO", "PN", "DP", "EL", "VM"][i % 10]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate">Player</div>
                        <div className="text-[11px] text-muted-foreground">
                          Sample roster · read-only
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Host-only payment setup link */}
      <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4 mt-4">
        <Link
          to="/games/$gameId/payment-setup"
          params={{ gameId: game.id }}
          className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-surface/40 p-3 text-xs text-muted-foreground hover:border-lime/40"
        >
          <SettingsIcon className="h-4 w-4 text-lime" />
          <span className="flex-1">Host of this game? Configure payment methods & fee.</span>
          <span className="text-lime">→</span>
        </Link>
        <div className="mt-3">
          <LegalNotice compact />
        </div>
      </div>

      {/* Sticky CTA */}
      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+6rem)] left-0 right-0 z-30 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur-xl bg-background/80 border-t border-border">
        <div className="mx-auto max-w-md flex items-center gap-2">
          <button
            disabled={messaging}
            onClick={async () => {
              if (!user) {
                nav({ to: "/auth" });
                return;
              }
              const hostUid = settings?.host_id;
              if (!hostUid) {
                toast.error("This host can't be messaged yet.");
                return;
              }
              if (hostUid === user.id) {
                nav({ to: "/messages" });
                return;
              }
              setMessaging(true);
              try {
                const cid = await getOrCreateDirectConversation(hostUid, game.id);
                nav({ to: "/messages/$conversationId", params: { conversationId: cid } });
              } catch (e: any) {
                toast.error(e.message);
              } finally {
                setMessaging(false);
              }
            }}
            className="grid h-12 w-12 place-items-center rounded-2xl border border-border bg-surface disabled:opacity-50"
          >
            <MessageCircle className="h-5 w-5" />
          </button>
          {!isHost && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleJoin}
              disabled={!joined && !isPending && !isConfirmed && spotsLeft <= 0}
              className={`flex-1 rounded-2xl py-3.5 font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${
                isConfirmed
                  ? "bg-lime/15 border border-lime/40 text-lime"
                  : isPending
                    ? "bg-surface border border-coral/40 text-coral"
                    : joined
                      ? "bg-surface border border-lime/40 text-lime"
                      : "bg-lime-gradient text-primary-foreground glow-lime"
              }`}
            >
              {isConfirmed ? (
                <>
                  <Check className="h-4 w-4" /> Confirmed · Tap to leave
                </>
              ) : isPending ? (
                <>
                  <Clock className="h-4 w-4" />{" "}
                  {latestSub?.status === "pending"
                    ? "Payment pending · Tap to withdraw"
                    : "Request pending · Tap to cancel"}
                </>
              ) : joined && !isPaid ? (
                <>
                  <Check className="h-4 w-4" /> You're in · Tap to leave
                </>
              ) : spotsLeft <= 0 ? (
                <>Full</>
              ) : requiresApproval && !isApproved ? (
                <>
                  Request to join · {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left
                </>
              ) : isPaid ? (
                <>
                  <CreditCard className="h-4 w-4" /> Pay host · ${fee.toFixed(2)}
                </>
              ) : (
                <>
                  Join free · {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left
                </>
              )}
            </motion.button>
          )}
        </div>
      </div>

      {isHost && editOpen && <EditGameModal game={game} onClose={() => setEditOpen(false)} />}
    </div>
  );
}

function EditGameModal({ game, onClose }: { game: Game; onClose: () => void }) {
  const [title, setTitle] = useState(game.title);
  const [location, setLocation] = useState(game.location);
  const [dateLocal, setDateLocal] = useState(() => {
    const d = new Date(game.date);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [maxPlayers, setMaxPlayers] = useState(String(game.maxPlayers));
  const [price, setPrice] = useState(String(game.price));
  const [description, setDescription] = useState(game.description);

  const save = () => {
    const mp = Math.max(2, Math.min(200, Number(maxPlayers) || game.maxPlayers));
    const pr = Math.max(0, Number(price) || 0);
    const iso = new Date(dateLocal).toISOString();
    const updated = updateHostedGame(game.id, {
      title: title.trim() || game.title,
      location: location.trim() || game.location,
      date: Number.isFinite(new Date(dateLocal).getTime()) ? iso : game.date,
      maxPlayers: mp,
      price: pr,
      description,
    });
    if (!updated) {
      toast.error("This game can't be edited here.");
      return;
    }
    toast.success("Game updated.");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Edit game</h2>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-border"
            aria-label="Close"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 space-y-3">
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Location">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Date & time">
            <input
              type="datetime-local"
              value={dateLocal}
              onChange={(e) => setDateLocal(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max players">
              <input
                type="number"
                min={2}
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Price ($)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-border bg-background py-2.5 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="flex-1 rounded-xl bg-lime-gradient py-2.5 text-sm font-bold text-primary-foreground"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-semibold text-sm">{value}</div>
    </div>
  );
}

function RosterPlayerRow({
  req,
  gameTitle,
  feeRequired,
  onChange,
}: {
  req: JoinRequest;
  gameTitle: string;
  feeRequired: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string>("Player");
  const [initials, setInitials] = useState<string>("P");
  const [paymentStatus, setPaymentStatus] = useState<"verified" | "pending" | "rejected" | "none">(
    "none",
  );
  const reviews = useReviewsFor(req.player_id);
  const rep = useMemo(() => computeReputation(reviews, "player"), [reviews]);
  const reliability = rep.criteriaAverages.find((c) => c.key === "reliability")?.avg ?? 0;
  const sportsmanship = rep.criteriaAverages.find((c) => c.key === "sportsmanship")?.avg ?? 0;

  useEffect(() => {
    let cancel = false;
    const loadPayment = async () => {
      const { data } = await supabase
        .from("payment_submissions")
        .select("status")
        .eq("game_id", req.game_id)
        .eq("player_id", req.player_id)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancel) return;
      const s = (data as any)?.status;
      setPaymentStatus(s === "verified" || s === "pending" || s === "rejected" ? s : "none");
    };
    (async () => {
      const profRes = await supabase
        .from("profiles")
        .select("display_name, avatar_initials")
        .eq("id", req.player_id)
        .maybeSingle();
      if (!cancel) {
        const d = profRes.data as any;
        if (d) {
          const n = d.display_name ?? "Player";
          setName(n);
          setInitials((d.avatar_initials ?? n.slice(0, 2)).toUpperCase());
        }
      }
      await loadPayment();
    })();

    // Realtime: update paid chip immediately when this player's submission for this game changes.
    const channel = supabase
      .channel(`payment_submissions:${req.game_id}:${req.player_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payment_submissions",
          filter: `player_id=eq.${req.player_id}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as any;
          if (row?.game_id && row.game_id !== req.game_id) return;
          loadPayment();
        },
      )
      .subscribe();

    return () => {
      cancel = true;
      supabase.removeChannel(channel);
    };
  }, [req.player_id, req.game_id]);

  const remove = async () => {
    if (!confirm(`Remove ${name} from ${gameTitle}?`)) return;
    setBusy(true);
    try {
      await reviewJoinRequest(req.id, "rejected", "Removed by host");
      await createNotification({
        user_id: req.player_id,
        type: "join_declined",
        title: `Removed from ${gameTitle}`,
        body: "The host removed you from this game.",
        link: `/games/${req.game_id}`,
      });
      toast.success(`${name} removed.`);
      onChange();
    } catch (e: any) {
      toast.error(e.message ?? "Could not remove.");
    } finally {
      setBusy(false);
    }
  };

  const fmt = (n: number) => (n > 0 ? n.toFixed(1) : "—");
  const paymentChip = !feeRequired
    ? null
    : paymentStatus === "verified"
      ? { label: "Paid", cls: "border-lime/40 bg-lime/10 text-lime" }
      : paymentStatus === "pending"
        ? { label: "Payment pending", cls: "border-coral/40 bg-coral/10 text-coral" }
        : paymentStatus === "rejected"
          ? { label: "Payment rejected", cls: "border-coral/50 bg-coral/15 text-coral" }
          : { label: "Unpaid", cls: "border-border bg-secondary text-muted-foreground" };

  return (
    <div className="rounded-2xl border border-lime/30 bg-surface p-3">
      <div className="flex items-center gap-3">
        <Link
          to="/players/$userId"
          params={{ userId: req.player_id }}
          className="grid h-10 w-10 place-items-center rounded-full bg-lime-gradient text-xs font-bold text-primary-foreground"
        >
          {initials.slice(0, 2)}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{name}</div>
          <div className="text-[11px] text-muted-foreground">
            {rep.count > 0
              ? `${rep.count} review${rep.count === 1 ? "" : "s"} · trust ${rep.trustScore}`
              : "No reviews yet"}
          </div>
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/10 px-3 py-1.5 text-xs font-bold text-coral disabled:opacity-50"
        >
          <XIcon className="h-3.5 w-3.5" /> Remove
        </button>
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
        <span className="inline-flex items-center gap-1 rounded-full border border-lime/40 bg-lime/10 px-2 py-0.5 text-[10px] font-bold text-lime">
          <Check className="h-3 w-3" /> Approved
        </span>
        {paymentChip && (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${paymentChip.cls}`}
          >
            <CreditCard className="h-3 w-3" /> {paymentChip.label}
          </span>
        )}
      </div>
    </div>
  );
}

function HostRequestRow({
  req,
  gameTitle,
  onChange,
}: {
  req: JoinRequest;
  gameTitle: string;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string>("Player");
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_initials")
        .eq("id", req.player_id)
        .maybeSingle();
      if (data) setName((data as any).display_name ?? "Player");
    })();
  }, [req.player_id]);

  const act = async (status: "approved" | "rejected") => {
    setBusy(true);
    try {
      await reviewJoinRequest(req.id, status);
      await createNotification({
        user_id: req.player_id,
        type: status === "approved" ? "join_approved" : "join_declined",
        title: status === "approved" ? `You're in: ${gameTitle}` : `Request declined: ${gameTitle}`,
        body:
          status === "approved"
            ? "The host approved your request."
            : "The host declined your request.",
        link: `/games/${req.game_id}`,
      });
      toast.success(status === "approved" ? "Approved" : "Declined");
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`rounded-2xl border p-3 ${req.status === "pending" ? "border-border bg-surface" : "border-border/50 bg-surface/40 opacity-70"}`}
    >
      <div className="flex items-center gap-2">
        <Link
          to="/players/$userId"
          params={{ userId: req.player_id }}
          className="grid h-9 w-9 place-items-center rounded-full bg-lime-gradient text-xs font-bold text-primary-foreground hover:ring-2 hover:ring-lime"
          aria-label={`View ${name}'s profile`}
        >
          {name.slice(0, 2).toUpperCase()}
        </Link>
        <div className="flex-1 min-w-0">
          <Link
            to="/players/$userId"
            params={{ userId: req.player_id }}
            className="text-sm font-semibold truncate hover:text-lime hover:underline block"
          >
            {name}
          </Link>
          {req.message && (
            <div className="text-xs text-muted-foreground truncate">"{req.message}"</div>
          )}
        </div>
        {req.status === "pending" ? (
          <div className="flex gap-1.5">
            <button
              disabled={busy}
              onClick={() => act("rejected")}
              className="grid h-9 w-9 place-items-center rounded-xl border border-coral/40 text-coral disabled:opacity-50"
            >
              <XIcon className="h-4 w-4" />
            </button>
            <button
              disabled={busy}
              onClick={() => act("approved")}
              className="grid h-9 w-9 place-items-center rounded-xl bg-lime-gradient text-primary-foreground disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <span className="text-xs font-semibold uppercase">{req.status}</span>
        )}
      </div>
    </div>
  );
}

function HostPendingChip({
  req,
  gameTitle,
  onChange,
  index,
}: {
  req: JoinRequest;
  gameTitle: string;
  onChange: () => void;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string>("Player");
  const [initials, setInitials] = useState<string>("?");
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_initials")
        .eq("id", req.player_id)
        .maybeSingle();
      if (data) {
        const dn = (data as any).display_name ?? "Player";
        setName(dn);
        setInitials(((data as any).avatar_initials ?? dn.slice(0, 2)).toUpperCase());
      }
    })();
  }, [req.player_id]);

  const act = async (status: "approved" | "rejected") => {
    setBusy(true);
    try {
      await reviewJoinRequest(req.id, status);
      await createNotification({
        user_id: req.player_id,
        type: status === "approved" ? "join_approved" : "join_declined",
        title: status === "approved" ? `You're in: ${gameTitle}` : `Request declined: ${gameTitle}`,
        body:
          status === "approved"
            ? "The host approved your request."
            : "The host declined your request.",
        link: `/games/${req.game_id}`,
      });
      toast.success(status === "approved" ? `Approved ${name}` : `Declined ${name}`);
      setOpen(false);
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <motion.button
        type="button"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: index * 0.04 }}
        onClick={() => setOpen((v) => !v)}
        title={`${name} — tap to approve or decline`}
        aria-label={`Review ${name}'s pickup request`}
        className={`relative grid h-11 w-11 place-items-center rounded-full border border-dashed text-xs font-bold transition ${
          open
            ? "border-coral bg-coral/20 text-coral ring-2 ring-coral/40"
            : "border-coral/60 bg-coral/10 text-coral hover:bg-coral/20"
        }`}
      >
        {initials}
        <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-coral text-[8px] text-white">
          <Clock className="h-2.5 w-2.5" />
        </span>
      </motion.button>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute z-20 left-1/2 top-[calc(100%+6px)] -translate-x-1/2 w-56 rounded-2xl border border-border bg-background shadow-lg p-2"
        >
          <Link
            to="/players/$userId"
            params={{ userId: req.player_id }}
            className="block px-2 py-1 text-sm font-semibold truncate hover:text-lime"
          >
            {name}
          </Link>
          {req.message && (
            <div className="px-2 pb-2 text-[11px] text-muted-foreground line-clamp-3">
              "{req.message}"
            </div>
          )}
          <div className="flex gap-1.5 mt-1">
            <button
              disabled={busy}
              onClick={() => act("rejected")}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl border border-coral/40 text-coral py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              <XIcon className="h-3.5 w-3.5" /> Decline
            </button>
            <button
              disabled={busy}
              onClick={() => act("approved")}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-lime-gradient text-primary-foreground py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" /> Approve
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
