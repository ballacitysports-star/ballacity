import { VenueHostedAt } from "@/components/venue/VenueBadge";
import { BackButton } from "@/components/layout/BackButton";
import { ListingVisibilityToggle } from "@/components/listings/ListingVisibilityToggle";
import { RosterRecruitPanel } from "@/components/players/RosterRecruitPanel";
import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { AuthRedirectSkeleton } from "@/components/AuthRedirectSkeleton";
import { PublicGamePreview } from "@/components/games/PublicGamePreview";
import { emailLocalPart } from "@/lib/managed-children";
import { Navigation } from "lucide-react";
import { OpenInMaps } from "@/components/OpenInMaps";
import { GameDayActionSheet } from "@/components/games/GameDayActionSheet";
import { describeMessagingError } from "@/lib/minor-messaging";
import { RouteFallback, FALLBACK_ACTION_CLASS } from "@/components/layout/RouteFallback";
import { trackEvent, trackTaskError } from "@/lib/analytics";
import { getPublicGameSeo } from "@/lib/city-pages.functions";
import { gamePageHead } from "@/lib/game-head";
import { motion, AnimatePresence } from "framer-motion";
import {
  Share2,
  MapPin,
  Clock,
  Users,
  Calendar,
  MessageCircle,
  Star,
  Check,
  Wallet,
  X as XIcon,
  Pencil,
  Play,
  Lock,
  Unlock,
  Trash2,
  Flag,
  Ban,
  UserCheck,
  UserX,
} from "lucide-react";
import { ReportDialog } from "@/components/ReportDialog";
import { RiskAcknowledgmentDialog } from "@/components/safety/RiskAcknowledgmentDialog";
import { needsRiskAcknowledgment, RISK_ACKNOWLEDGMENT } from "@/lib/safety";
import { recordSafetyAck, useSafetyAck } from "@/lib/safety-acks";
import { ShieldAlert } from "lucide-react";
import { GAMES, SPORTS } from "@/lib/sample-data";
import {
  ageGateMessage,
  ageGateState,
  ageRequirementLabel,
  hasAgeRequirement,
} from "@/lib/game-age";
import { useMyAge } from "@/lib/use-my-age";
import { formatGameWhen, formatWhenDate } from "@/lib/format";
import { gameEndsAt } from "@/lib/game-time";
import { AddToCalendarButton } from "@/components/datetime/AddToCalendarButton";
import { GameReminderCard, GameReminderPicker } from "@/components/GameReminderSettings";
import { DEFAULT_GAME_REMINDER_OFFSETS, saveMyGameReminderOffsets } from "@/lib/game-reminders";
import { ReviewsSection } from "@/components/ReviewsSection";
import { SpotsPill } from "@/components/SpotsPill";
import { UserAvatar, UserAvatarById } from "@/components/UserAvatar";
import { computeReputation } from "@/lib/reviews";
import { useReviewsFor } from "@/lib/reviews-db";
import { GamePolicySummary } from "@/components/games/GamePolicySummary";
import { HostTrustPanel } from "@/components/games/HostTrustPanel";
import {
  cancelGame,
  completeGame,
  markAttendance,
  useHostAttendanceStats,
} from "@/lib/game-lifecycle";
import { resolveGameStatus, GAME_STATUS_TONE_CLASS } from "@/lib/game-status";
import { normalizeGamePolicy, type GamePolicy, type HostTrust } from "@/lib/game-policy";
import { ReputationBadge } from "@/components/ReputationBadge";
import { joinGame, leaveGame, useIsJoined } from "@/lib/games-store";
import { useLiveParticipantCount } from "@/lib/game-participants-store";
import { useLiveParticipants } from "@/lib/game-roster";
import { useGameRealtimeChannels } from "@/lib/game-realtime";
import { useGameWaitlist, joinWaitlist, leaveWaitlist } from "@/lib/waitlist-store";
import { WaitlistManager, WaitlistStatusPill } from "@/components/WaitlistManager";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getGamePaymentSettings,
  listMySubmissionsForGame,
  deleteMyPendingSubmission,
  getMyJoinRequest,
  createJoinRequest,
  cancelMyJoinRequest,
  withdrawMyApprovedJoinRequest,
  hostRemoveParticipant,
  listHostJoinRequests,
  joinResubmitCooldownRemainingMs,
  joinResubmitCapReached,
  JOIN_RESUBMIT_MAX_ATTEMPTS,
  type GamePaymentSettings,
  type PaymentSubmission,
  type JoinRequest,
} from "@/lib/payments";
import {
  formatHoldRemaining,
  holdExpiresAt,
  useNow,
  usePaymentHoldSweep,
} from "@/lib/payment-hold";
import { shouldTriggerLeaveBranch } from "@/lib/leave-branch";
import { useMyFlowStatus } from "@/lib/game-flow-status";
import { PlayerFlowPill } from "@/components/PlayerFlowPill";
import { LeaveFlowButton } from "@/components/LeaveFlowButton";
import { useHasActiveGuardian } from "@/lib/use-has-guardian";
import { hostTeamLink, useGameHost } from "@/lib/game-host-team";
import { getJoinGuardianNeeds } from "@/lib/join-guardian.functions";
import { joinWait, playerWaitCopy } from "@/lib/join-guardian-status";
import { refundTermsDisplay } from "@/lib/refund-policy";
import { useGameJoinPolicy } from "@/hooks/use-game-join-policy";
import { useGameRefundTerms } from "@/hooks/use-game-refund-terms";
import {
  CANCEL_CUTOFF_PRESETS,
  cancelPolicyNote,
  isLateCancel,
  lateCancelWarning,
  normalizeCutoff,
} from "@/lib/cancel-window";
import { PaymentRequiredBanner } from "@/components/PaymentRequiredBanner";
import { HostPaymentsPanel, PlayerPaymentsPanel } from "@/components/GamePaymentsPanel";
import { PostEngagement } from "@/components/PostEngagement";
import { GameDistance } from "@/components/GameDistance";
import { SeriesSessionsStrip } from "@/components/SeriesSessionsStrip";
import { ShareSheet } from "@/components/ShareSheet";
import { buildGameShare } from "@/lib/social-share";
import {
  useHostedGames,
  fetchHostedGame,
  updateHostedGame,
  deleteHostedGame,
} from "@/lib/hosted-games-store";
import { formatSkillValue } from "@/lib/sport-levels";
import type { Game } from "@/lib/sample-data";
import { useQuery } from "@tanstack/react-query";
import { useJoinGate, SIGNUP_CUTOFF_PRESETS, cutoffAmountLabel } from "@/lib/live-status";
import type { JoinGate } from "@/lib/live-status";
import { JoinBlockedReason } from "@/components/JoinBlockedReason";
import { useAuth } from "@/hooks/use-auth";
import { useParentMode } from "@/hooks/use-parent-mode";
import { useMyChildStatus } from "@/lib/child-safety";
import { useMyProfile } from "@/lib/user-prefs-store";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { createNotification } from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { MediaImage } from "@/components/MediaImage";
import { useCanReview } from "@/lib/transactions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  formatCooldownLabel,
  formatEndsAt,
  hostReviewId,
  Meta,
} from "@/components/game-detail/GameDetailBits";
import type { RosterEntry } from "@/components/game-detail/game-roster-entry";
import { EditGameModal } from "@/components/game-detail/EditGameModal";
import { RosterPlayerRow } from "@/components/game-detail/RosterPlayerRow";
import { HostRequestRow, HostPendingChip } from "@/components/game-detail/HostRequestRows";
import { GameLocationCard } from "@/components/game-detail/GameInfoSections";
import { GamePaymentTerms } from "@/components/game-detail/GameInfoSections";
import { GameHostSection } from "@/components/game-detail/GameHostSection";
import { GamePlayersSection } from "@/components/game-detail/GamePlayersSection";
import { GameApprovalBanner } from "@/components/game-detail/GameApprovalBanner";

const emojiBySport: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.name, s.emoji]),
);

export const Route = createFileRoute("/games/$gameId/")({
  validateSearch: (search: Record<string, unknown>) => {
    const out: {
      invite?: true;
      from?: string;
      exp?: number;
      expInvalid?: true;
      tab?: "overview" | "payments";
      modal?: "reviews" | "positions" | "edit";
    } = {};
    if (search.invite === "1" || search.invite === 1 || search.invite === true) out.invite = true;
    if (typeof search.from === "string" && search.from.length > 0) out.from = search.from;
    const rawExp = search.exp;
    if (rawExp !== undefined && rawExp !== null && rawExp !== "") {
      const expNum =
        typeof rawExp === "number" ? rawExp : typeof rawExp === "string" ? Number(rawExp) : NaN;
      if (Number.isFinite(expNum) && expNum > 0) out.exp = expNum;
      else out.expInvalid = true;
    }
    if (search.tab === "overview" || search.tab === "payments") out.tab = search.tab;
    if (search.modal === "reviews" || search.modal === "positions" || search.modal === "edit") {
      out.modal = search.modal;
    }
    return out;
  },

  loader: async ({ params }) => {
    // Public facts for the page head. A failed read must not break the page:
    // the head falls back to a generic, noindex description.
    const seo = await getPublicGameSeo({ data: { id: params.gameId } }).catch(() => null);
    return { gameId: params.gameId, seo };
  },
  head: ({ loaderData, params }) => gamePageHead(params.gameId, loaderData?.seo ?? null),
  notFoundComponent: () => (
    <div className="min-h-dvh grid place-items-center px-6 text-center">
      <div>
        <h1 className="page-title">Game not found</h1>
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
  errorComponent: ({ error, reset }) => (
    <RouteFallback
      title="Something went wrong"
      message="This game couldn't be loaded."
      error={error}
      onRetry={reset}
      action={
        <Link to="/feed" className={FALLBACK_ACTION_CLASS}>
          Back to feed
        </Link>
      }
    />
  ),
  component: GameRoute,
});

/**
 * Signed-out visitors (a shared link, a search result) get the short public
 * preview; everything else, including the join and pay actions, is the
 * signed-in page below.
 */
function GameRoute() {
  const { user, loading } = useAuth();
  const { seo } = Route.useLoaderData();
  const { pathname, searchStr } = useLocation();
  if (loading) return <AuthRedirectSkeleton label="Loading game…" />;
  if (!user) return <PublicGamePreview seo={seo} next={`${pathname}${searchStr}`} />;
  return <GameDetail />;
}

function GameDetail() {
  const { gameId } = Route.useLoaderData();
  useEffect(() => {
    trackEvent("view_game", { game_id: gameId });
  }, [gameId]);
  const { invite: isInvite, from: inviteFrom, exp: inviteExp, expInvalid } = Route.useSearch();
  const inviteExpired = !!(isInvite && ((inviteExp && inviteExp < Date.now()) || expInvalid));

  const hosted = useHostedGames();
  const [remoteGame, setRemoteGame] = useState<Game | null>(null);
  const [lookupComplete, setLookupComplete] = useState(false);
  const game = useMemo<Game | undefined>(
    () => hosted.find((g) => g.id === gameId) ?? remoteGame ?? GAMES.find((g) => g.id === gameId),
    [hosted, remoteGame, gameId],
  );
  const {
    invite: _iv,
    from: _fr,
    exp: _ex,
    expInvalid: _ei,
    tab: urlTab,
    modal: urlModal,
  } = Route.useSearch();
  void _iv;
  void _fr;
  void _ex;
  void _ei;
  const joined = useIsJoined(gameId);
  const liveParticipantCount = useLiveParticipantCount(gameId);
  const {
    participants: liveRoster,
    refetch: refetchRoster,
    removeLocal: removeRosterLocal,
  } = useLiveParticipants(gameId);
  const { entries: waitlistEntries } = useGameWaitlist(gameId);
  const nav = useNavigate();
  const { user } = useAuth();
  const { isParentMode } = useParentMode();
  const myProfile = useMyProfile(user);
  const { can: canChildFeature } = useMyChildStatus();
  const participationDecision = canChildFeature("game_participation");
  const messagingDecision = canChildFeature("direct_messaging");
  const [settings, setSettings] = useState<GamePaymentSettings | null>(null);
  const refundTerms = useGameRefundTerms(gameId, settings);
  // The full settings row is host-and-linked-only, so a prospective viewer reads
  // the host's approval setting from the public join-policy RPC instead.
  const publicRequiresApproval = useGameJoinPolicy(gameId, settings);
  const [mySubs, setMySubs] = useState<PaymentSubmission[]>([]);
  const [myReq, setMyReq] = useState<JoinRequest | null>(null);
  const [hostRequests, setHostRequests] = useState<JoinRequest[]>([]);
  const [messaging, setMessaging] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [editOpen, _setEditOpen] = useState(urlModal === "edit");
  const [requesting, setRequesting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [positionRosterOpen, _setPositionRosterOpen] = useState(urlModal === "positions");
  const [reviewsOpen, _setReviewsOpen] = useState(urlModal === "reviews");
  const [activeTab, _setActiveTab] = useState<"overview" | "payments">(urlTab ?? "overview");
  const {
    status: myFlowStatus,
    settings: flowSettings,
    refresh: refreshFlowStatus,
  } = useMyFlowStatus(gameId);

  // Deep-link writers: mirror UI state into the URL so refresh/share re-opens
  // the same tab or modal. Only one modal can be encoded at a time.
  const updateSearch = useCallback(
    (patch: {
      tab?: "overview" | "payments" | null;
      modal?: "reviews" | "positions" | "edit" | null;
    }) => {
      nav({
        to: "/games/$gameId",
        params: { gameId },
        search: (prev: any) => {
          const next = { ...prev };
          if ("tab" in patch) {
            if (patch.tab && patch.tab !== "overview") next.tab = patch.tab;
            else delete next.tab;
          }
          if ("modal" in patch) {
            if (patch.modal) next.modal = patch.modal;
            else delete next.modal;
          }
          return next;
        },
        replace: true,
      });
    },
    [nav, gameId],
  );
  const setActiveTab = useCallback(
    (t: "overview" | "payments") => {
      _setActiveTab(t);
      updateSearch({ tab: t });
    },
    [updateSearch],
  );
  const setEditOpen = useCallback(
    (v: boolean) => {
      _setEditOpen(v);
      updateSearch({ modal: v ? "edit" : null });
    },
    [updateSearch],
  );
  const setReviewsOpen = useCallback(
    (v: boolean) => {
      _setReviewsOpen(v);
      updateSearch({ modal: v ? "reviews" : null });
    },
    [updateSearch],
  );
  const setPositionRosterOpen = useCallback(
    (v: boolean) => {
      _setPositionRosterOpen(v);
      updateSearch({ modal: v ? "positions" : null });
    },
    [updateSearch],
  );

  // Follow URL changes (back/forward, external link updates) into state.
  useEffect(() => {
    _setActiveTab(urlTab ?? "overview");
  }, [urlTab]);
  useEffect(() => {
    _setEditOpen(urlModal === "edit");
    _setPositionRosterOpen(urlModal === "positions");
    _setReviewsOpen(urlModal === "reviews");
  }, [urlModal]);

  // Ticking clock (1s) that re-renders while the resubmit cooldown counts down.
  // Only starts when there's an active cooldown to avoid unnecessary re-renders.
  const cooldownMs = joinResubmitCooldownRemainingMs(myReq);
  const capReached = joinResubmitCapReached(myReq);
  const [, setNowTick] = useState(0);
  const [reportGameOpen, setReportGameOpen] = useState(false);
  // Risk-acknowledgment gate state (physical activity safety).
  const [riskAckOpen, setRiskAckOpen] = useState(false);
  const pendingJoinPositionRef = useRef<string | null>(null);
  const { data: riskAckVersion, refetch: refetchRiskAck } = useSafetyAck(
    gameId,
    "participant_risk",
  );

  useEffect(() => {
    if (cooldownMs <= 0) return;
    const t = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [cooldownMs > 0]);

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
  const hasGuardian = useHasActiveGuardian();
  // A minor's request needs the host and a guardian; say who is still to answer.
  const myWait =
    !isHost && myReq
      ? joinWait({
          hostStatus: myReq.status,
          needsGuardian: hasGuardian,
          guardianApproved: !!myReq.guardian_approved_at,
        })
      : null;
  // Host only: which requests come from a minor with a guardian, and whether the
  // guardian has approved. Refetched when a request changes.
  const guardianNeedsQuery = useQuery({
    queryKey: [
      "join-guardian-needs",
      gameId,
      hostRequests.map((r) => `${r.id}:${r.status}:${r.guardian_approved_at ? 1 : 0}`).join(","),
    ],
    enabled: isHost && hostRequests.length > 0,
    staleTime: 30_000,
    queryFn: () => getJoinGuardianNeeds({ data: { gameId } }),
  });
  const guardianNeedByRequest = new Map(
    (guardianNeedsQuery.data ?? []).map((n) => [n.requestId, n] as const),
  );

  const hostReviews = useReviewsFor(hostReviewId(game));
  const hostRep = useMemo(() => computeReputation(hostReviews, "host"), [hostReviews]);
  const canReviewHost = useCanReview(hostReviewId(game));

  // Policy players must be able to read before joining.
  const viewerPolicy = useMemo<GamePolicy>(
    () =>
      normalizeGamePolicy({
        cancellationPolicy: (game?.cancellationPolicy ??
          undefined) as GamePolicy["cancellationPolicy"],
        cancellationNotes: game?.cancellationNotes ?? "",
        minPlayers: game?.minPlayers ?? 0,
        maxPlayers: game?.maxPlayers ?? 10,
        allowWaitlist: game?.allowWaitlist ?? true,
        entryFee: Number(settings?.entry_fee ?? game?.price ?? 0) || 0,
        requiresApproval: settings ? !!settings.requires_approval : true,
        refundRule: (settings?.refund_rule ?? undefined) as GamePolicy["refundRule"],
        lateRefundPct: settings?.late_refund_pct ?? 0,
        cancelCutoffMin: game?.cancelCutoffMin,
        refundPolicy: settings?.refund_policy ?? "",
        gameRules: game?.gameRules ?? "",
      }),
    [game, settings],
  );

  // Host trust: only real signals. Verification comes from the hosting team
  // profile's verified flag — never invented.
  const [hostTeamVerified, setHostTeamVerified] = useState<boolean | null>(null);
  useEffect(() => {
    const teamId = game?.teamId;
    if (!teamId) {
      setHostTeamVerified(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("teams")
        .select("verified")
        .eq("id", teamId)
        .maybeSingle();
      if (!cancelled) setHostTeamVerified(!!(data as { verified?: boolean } | null)?.verified);
    })();
    return () => {
      cancelled = true;
    };
  }, [game?.teamId]);

  // A game made on behalf of a team is hosted by that team; the person who set it
  // up is its organizer.
  const hostTeam = useGameHost(game);
  const hostAttendance = useHostAttendanceStats(game?.hostUserId ?? settings?.host_id ?? undefined);

  const hostTrust = useMemo<HostTrust>(() => {
    const hostUserId = game?.hostUserId ?? settings?.host_id ?? null;
    const gamesHosted = hostUserId ? hosted.filter((g) => g.hostUserId === hostUserId).length : 0;
    return {
      gamesHosted,
      rating: hostRep.count > 0 ? hostRep.avg : null,
      reviewCount: hostRep.count,
      // Real signal only: the share of host-marked roster spots that showed
      // up. Null until this host has marked attendance at least once.
      attendanceRate: hostAttendance?.attendanceRate ?? null,
      verified: hostTeamVerified === true,
      verifiedLabel: hostTeamVerified === true ? "Verified team profile" : null,
    };
  }, [game?.hostUserId, settings?.host_id, hosted, hostRep, hostTeamVerified, hostAttendance]);

  // Guards refreshStatus while a leave flow is tearing down local + server
  // state. Realtime DELETE events for join_requests / payment_submissions
  // fire during the teardown and would otherwise refetch the (still-
  // committing) rows and re-hydrate the "Payment verified" strip.
  const leavingRef = useRef(false);
  // The approved-player fallback below tries once per approval/payment state, so
  // a join the server keeps refusing (roster filled up) doesn't toast on every refresh.
  const autoJoinTriedRef = useRef<string | null>(null);

  const refreshStatus = async () => {
    if (!game) return;
    if (leavingRef.current) return;
    try {
      // Settings decide the CTA (fee, approval). Publish them as soon as they
      // arrive: the viewer's own submissions and join request are optional
      // status lookups, and a slow or hung one must not hold the page on the
      // fail-closed "Request Spot" default (requiresApproval with no settings).
      const settingsLoaded = getGamePaymentSettings(game.id).then((s) => {
        if (!leavingRef.current) setSettings(s);
        return s;
      });
      const [s, subs, req] = await Promise.all([
        settingsLoaded,
        listMySubmissionsForGame(game.id),
        getMyJoinRequest(game.id),
      ]);
      if (leavingRef.current) return;
      setMySubs(subs);
      setMyReq(req);
      // Auto-join locally only when there's nothing left to pay. Otherwise the
      // Join CTA would flip to "leave" and hide the Pay flow after approval.
      const feeOwed = Number(s?.entry_fee ?? game.price ?? 0) > 0;
      const paidOk = subs[0]?.status === "verified";
      const guardianOk = !hasGuardian || !!req?.guardian_approved_at;
      if (req?.status === "approved" && !joined && guardianOk && (!feeOwed || paidOk)) {
        const attempt = `${req.id}:${subs[0]?.id ?? ""}:${subs[0]?.status ?? ""}`;
        if (autoJoinTriedRef.current !== attempt) {
          autoJoinTriedRef.current = attempt;
          void joinGame(game.id);
        }
      }
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

  // Optimistically flip a host-side join_request row's status. Returns an
  // undo function the caller runs on server error so the UI reverts to the
  // pre-tap state. Realtime `join_requests:host:*` events reconcile with
  // authoritative rows on success; we don't need a manual refetch.
  const applyOptimisticReview = (reqId: string, status: "approved" | "rejected"): (() => void) => {
    let snapshot: JoinRequest[] = [];
    setHostRequests((prev) => {
      snapshot = prev;
      return prev.map((r) =>
        r.id === reqId ? { ...r, status, reviewed_at: new Date().toISOString() } : r,
      );
    });
    return () => setHostRequests(snapshot);
  };

  // Host "Remove player" flow. `removeTarget` drives the confirmation
  // dialog; `removingId` disables the row while the delete is in flight so
  // a double-tap can't fire two requests.
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; name: string } | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Host "Cancel game" flow: a reason is required so every player on the
  // roster gets a notification that explains what happened.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  // Attendance marking (host only, opens once the game has started).
  const [attendanceBusy, setAttendanceBusy] = useState<string | null>(null);

  const handleRemoveParticipant = async (playerId: string, displayName: string) => {
    if (!game || !isHost) return;
    setRemovingId(playerId);
    // Optimistic UI: drop from both roster sources immediately.
    const prevHostReqs = hostRequests;
    removeRosterLocal(playerId);
    setHostRequests((prev) => prev.filter((r) => r.player_id !== playerId));
    try {
      await hostRemoveParticipant({ gameId: game.id, playerId });
      // Notify the removed player (best-effort).
      if (user && playerId !== user.id) {
        void createNotification({
          user_id: playerId,
          type: "participant_removed",
          title: `Removed from ${game.title}`,
          body: "The host removed you from the roster.",
          link: `/games/${game.id}`,
        }).catch(() => {});
      }
      toast.success(`Removed ${displayName} from the roster.`);
    } catch (e: any) {
      // Rollback.
      setHostRequests(prevHostReqs);
      void refetchRoster();
      toast.error(e?.message ?? "Could not remove player.");
    } finally {
      setRemovingId(null);
      setRemoveTarget(null);
      void refetchRoster();
      refreshHostRequests();
    }
  };

  const handleCancelGame = async () => {
    if (!game || !isHost) return;
    setCancelling(true);
    try {
      await cancelGame(game.id, cancelReason);
      await updateHostedGame(game.id, {
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        cancellationReason: cancelReason.trim() || null,
        joinsClosed: true,
      });
      trackEvent("cancel_game");
      toast.success("Game cancelled. Everyone on the roster was notified.");
      setCancelOpen(false);
      setCancelReason("");
    } catch (err) {
      trackTaskError("cancel_game");
      toast.error((err as { message?: string })?.message ?? "Couldn't cancel this game.");
    } finally {
      setCancelling(false);
    }
  };

  const handleAttendance = async (playerId: string, attended: boolean) => {
    if (!game || !isHost) return;
    setAttendanceBusy(playerId);
    try {
      await markAttendance(game.id, playerId, attended);
      await refetchRoster();
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? "Couldn't save attendance.");
    } finally {
      setAttendanceBusy(null);
    }
  };

  // Whether the live list still has this game. When the host hides it the list
  // drops it (a hidden game is not in the feed), but the host and anyone who
  // joined may still open it, so that flip must trigger a lookup by id.
  const inLiveList = hosted.some((g) => g.id === gameId);
  useEffect(() => {
    if (GAMES.some((g) => g.id === gameId) || inLiveList) {
      setLookupComplete(true);
      return;
    }

    let cancelled = false;
    setLookupComplete(false);
    setRemoteGame(null);
    fetchHostedGame(gameId)
      .then((found) => {
        if (!cancelled) setRemoteGame(found);
      })
      .catch(() => {
        if (!cancelled) setRemoteGame(null);
      })
      .finally(() => {
        if (!cancelled) setLookupComplete(true);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, inLiveList]);

  // Re-run status/roster fetches whenever the viewed game OR the signed-in
  // user changes so switching games or accounts always yields fresh data
  // matched to the current view (subscriptions below re-key on the same
  // ids and auto-resubscribe).
  useEffect(() => {
    refreshStatus();
    void refetchRoster();
    /* eslint-disable-next-line */
  }, [game?.id, user?.id]);
  useEffect(() => {
    refreshHostRequests();
  }, [game?.id, user?.id, settings?.host_id, hostsThisGame]);

  // Realtime channels for approval, roster, and payment status. Channel keys
  // include gameId AND userId (where user-scoped) so switching games or
  // accounts always tears down old channels and re-subscribes with fresh ids.
  // Contract pinned by src/lib/game-realtime.test.tsx.
  useGameRealtimeChannels({
    gameId: game?.id,
    userId: user?.id,
    hostsThisGame,
    onHostJoinRequestChange: () => {
      refreshHostRequests();
    },
    onMyJoinRequestChange: () => {
      refreshStatus();
      void refetchRoster();
    },
    onSettingsChange: () => {
      refreshStatus();
      if (hostsThisGame) refreshHostRequests();
    },
    onMyPaymentChange: () => {
      refreshStatus();
      void refetchRoster();
    },
  });

  // Event-driven fallback: refetch when the tab regains focus or becomes
  // visible (covers the case where the realtime socket was suspended while
  // the tab was backgrounded). No polling interval — updates are driven by
  // realtime events plus these lifecycle events.
  useEffect(() => {
    if (!game?.id) return;
    const refreshAll = () => {
      refreshStatus();
      refreshHostRequests();
      void refetchRoster();
    };
    const onFocus = () => refreshAll();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshAll();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line
  }, [game?.id, user?.id, hostsThisGame]);

  // Ensure the realtime socket carries the current user's JWT so RLS-scoped
  // subscriptions aren't silently rejected right after sign-in / refresh.
  useEffect(() => {
    let cancelled = false;
    const applyAuth = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!cancelled && token) {
        try {
          supabase.realtime.setAuth(token);
        } catch {
          /* ignore */
        }
      }
    };
    void applyAuth();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const token = session?.access_token;
      if (token) {
        try {
          supabase.realtime.setAuth(token);
        } catch {
          /* ignore */
        }
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Realtime: surface in-app toasts as other players join or leave.
  // Compares snapshots of the live roster and skips the viewer's own
  // actions (they already get a "You're in" / "You left" toast) and the
  // first hydration (avoids a flood of "X joined" on page load).
  const rosterInitializedRef = useMemo(() => ({ current: false, ids: new Set<string>() }), []);
  useEffect(() => {
    const currentIds = new Set(liveRoster.map((p) => p.userId));
    if (!rosterInitializedRef.current) {
      rosterInitializedRef.current = true;
      rosterInitializedRef.ids = currentIds;
      return;
    }
    const prev = rosterInitializedRef.ids;
    const meId = user?.id ?? null;
    for (const p of liveRoster) {
      if (!prev.has(p.userId) && p.userId !== meId) {
        toast.success(`${p.displayName} joined the game`, {
          description: `${liveRoster.length}/${game?.maxPlayers ?? 0} players confirmed.`,
          duration: 4000,
        });
      }
    }
    for (const oldId of prev) {
      if (!currentIds.has(oldId) && oldId !== meId) {
        const oldName =
          // best-effort: we no longer have the profile, so keep it generic
          "A player";
        toast(`${oldName} left the game`, {
          description: "A spot just opened up.",
          duration: 4000,
        });
      }
    }
    rosterInitializedRef.ids = currentIds;
  }, [liveRoster, user?.id, game?.maxPlayers, rosterInitializedRef]);

  // Spot holds: sweep expired holds while the page is open and tick the
  // countdown. Hooks, so they stay above the early returns below.
  const holdMinutes = (flowSettings ?? settings)?.payment_hold_minutes ?? null;
  usePaymentHoldSweep(
    game?.id,
    Number(settings?.entry_fee ?? game?.price ?? 0) > 0 && !!holdMinutes,
  );
  const now = useNow();
  const { age: myAge } = useMyAge();
  const gate = useJoinGate(game);
  const [confirmAction, setConfirmAction] = useState<"join" | "leave" | null>(null);
  // Reminder lead times the player picks while RSVPing.
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([
    ...DEFAULT_GAME_REMINDER_OFFSETS,
  ]);

  if (!game && !lookupComplete) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!game) {
    return (
      <div className="min-h-dvh grid place-items-center px-6 text-center">
        <div>
          <h1 className="page-title">Game not found</h1>
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
  const myHoldExpiresAt = holdExpiresAt({
    approvedAt: myReq?.status === "approved" ? myReq.reviewed_at : null,
    holdMinutes,
    gameStartsAt: game.date,
  });
  const myHoldLabel = myHoldExpiresAt ? formatHoldRemaining(myHoldExpiresAt.getTime() - now) : null;
  // Host approval is the default. A game whose host hasn't saved settings yet
  // is treated as request-to-join; hosts can opt out in game settings. A
  // prospective viewer can't read the settings row, so the public join-policy
  // RPC supplies the host's actual flag; it's null until that resolves (or when
  // there is no settings row), and then the default holds.
  const hostRequiresApproval = publicRequiresApproval ?? true;
  // An age requirement forces the request-to-join flow for anyone outside the
  // range (or who hasn't shared a birthday), even on instant-join games.
  const ageReq = { minAge: game.minAge ?? null, maxAge: game.maxAge ?? null };
  const ageGate = ageGateState({ req: ageReq, viewerAge: myAge });
  const ageNeedsApproval = ageGate === "needs_approval" || ageGate === "unknown_age";
  const requiresApproval = hostRequiresApproval || (!isHost && ageNeedsApproval);
  const ageNotice = !isHost && ageNeedsApproval ? ageGateMessage(ageGate, ageReq) : null;
  const latestSub = mySubs[0];
  const isApproved = myReq?.status === "approved";
  const isRequestPending = myReq?.status === "pending";
  const isPaymentVerified = latestSub?.status === "verified";
  const isPaymentPending = latestSub?.status === "pending";
  // Approval-gated games treat approval as the *first* gate. Payment (if any)
  // becomes actionable only after the host approves the request.
  const approvalCleared = !requiresApproval || isApproved;
  const paymentCleared = !isPaid || isPaymentVerified;
  // A minor whose guardian has not approved is not confirmed, whatever the host said.
  const isConfirmed =
    approvalCleared &&
    paymentCleared &&
    (requiresApproval || isPaid ? true : false) &&
    !myWait?.onParent;
  // Only surface "payment pending" once approval is cleared, so players
  // don't see a payment-pending state before they've been approved.
  const isPending = isRequestPending || (approvalCleared && isPaymentPending);

  // The viewer counts as a roster player only when:
  //  - they're not the host (hosts run the game, they don't take a player slot), AND
  //  - either there's no approval gate and they've joined locally, OR
  //    the host has confirmed/approved them (paid-verified or approved request).
  const viewerCountsAsJoined = !isHost && (isConfirmed || (joined && !requiresApproval && !isPaid));
  // Prefer the live participant count from `game_participants` (updates in
  // real time when anyone joins/leaves on any device) and fall back to the
  // cached `game.joined` counter until hydration completes. When we already
  // have the live count, the viewer is already reflected in it — don't
  // double-count them.
  const baseJoined = liveParticipantCount ?? game.joined ?? 0;
  const viewerDelta = viewerCountsAsJoined && liveParticipantCount === undefined ? 1 : 0;
  const effectiveJoined = baseJoined + viewerDelta;
  const spotsLeft = Math.max(0, game.maxPlayers - effectiveJoined);
  // Display-only gate for the viewer: adds "roster full" on top of the
  // schedule/host gates so the CTA can always explain why joining is blocked.
  const viewerGate: JoinGate =
    gate.locked || spotsLeft > 0
      ? gate
      : {
          liveStatus: gate.liveStatus,
          joinState: "roster_full",
          label: "Roster full",
          reason: "The roster is full — no spots left.",
          locked: true,
          waitlistOpen: true,
        };

  const executeJoinAction = async (preselectedPosition?: string) => {
    // Expired invite → block all join actions and steer to discovery.
    if (inviteExpired && !isHost && !viewerCountsAsJoined && !viewerPending) {
      toast.error("This invite has expired. Browse open games instead.");
      nav({ to: "/discover" });
      return;
    }
    const gameHostId = settings?.host_id ?? game.hostUserId ?? null;
    // The host said yes but a guardian has not: nothing to join or pay yet.
    if (myWait?.onParent && !myWait.onHost) {
      toast.info("Waiting for your parent to approve. They can do it in their Parent Center.");
      return;
    }
    // Approved-but-unpaid on a paid game → route to pay page/status (don't
    // treat stale joined/pending payment state as leave/withdraw from here).
    if (isPaid && !paymentCleared && approvalCleared) {
      const search: { invite?: true; from?: string } = {};
      if (isInvite) search.invite = true;
      if (inviteFrom) search.from = inviteFrom;
      nav({ to: "/games/$gameId/pay", params: { gameId: game.id }, search });
      return;
    }
    // Confirmed → leave / withdraw. Only treat as leave when the viewer is
    // actually on the roster — a stale local `joined` flag on an approval-
    // or payment-gated game (e.g. right after leaving, before refetch) must
    // NOT re-trigger the leave branch when the user taps "Request to join".
    // Predicate extracted for unit-test coverage (see src/lib/leave-branch.ts).
    if (shouldTriggerLeaveBranch({ isConfirmed, joined, requiresApproval, isPaid })) {
      // Snapshot for rollback on server error.
      const prevReq = myReq;
      const prevSubs = mySubs;
      const wasJoined = joined;
      // Optimistic: flip UI immediately. Clear ALL of the viewer's local
      // request/submission state — including verified subs — so the sticky
      // CTA immediately collapses `isConfirmed` back to false and re-enables
      // "Request to join" / "Pay to join" without waiting for a refetch.
      leavingRef.current = true;
      setMyReq(null);
      setMySubs([]);
      leaveGame(game.id);
      if (user) removeRosterLocal(user.id);
      try {
        // Delete every open/verified submission the viewer had for this game
        // FIRST so the host's "pending approval" list clears and any realtime
        // refetch that lands after this step no longer sees a verified row.
        const clearableSubs = prevSubs.filter((s) => s.status !== "rejected");
        await Promise.all(
          clearableSubs.map((s) => deleteMyPendingSubmission(s.id).catch(() => {})),
        );
        if (prevReq?.status === "pending") {
          await cancelMyJoinRequest(game.id).catch(() => {});
        } else if (prevReq?.status === "approved") {
          await withdrawMyApprovedJoinRequest(game.id).catch(() => {});
        }
        // Also ensure the participant row is gone server-side before we drop
        // the guard, so the reconcile refetch sees a fully torn-down state.
        if (user) {
          await supabase
            .from("game_participants")
            .delete()
            .eq("game_id", game.id)
            .eq("user_id", user.id)
            .then(
              () => undefined,
              () => undefined,
            );
        }
        trackEvent("leave_game");
        toast("You left the game.");
        // Notify host in real time that a player left. A late leave gets its
        // own "cancelled late" notice from the database instead.
        if (
          gameHostId &&
          user &&
          gameHostId !== user.id &&
          !isLateCancel(game.date, game.cancelCutoffMin)
        ) {
          const who = myProfile?.name || emailLocalPart(user.email) || "A player";
          void createNotification({
            user_id: gameHostId,
            type: "participant_left",
            title: `${who} left ${game.title}`,
            body: "Their spot is open again.",
            link: `/games/${game.id}`,
          }).catch(() => {});
        }
      } catch (e: any) {
        // Rollback optimistic state.
        setMyReq(prevReq);
        setMySubs(prevSubs);
        if (wasJoined) void joinGame(game.id);
        toast.error(e.message ?? "Could not leave.");
      } finally {
        leavingRef.current = false;
        // Single reconcile pass now that all deletes have committed. The shared
        // flow status (status strip, pill) re-reads too: realtime DELETE events
        // can't be matched to this game, so it would otherwise keep showing the
        // pre-leave state.
        void refreshStatus();
        refreshFlowStatus();
        void refetchRoster();
      }
      return;
    }
    // Pending → cancel request / withdraw submission
    if (isPending) {
      const prevReq = myReq;
      const prevSubs = mySubs;
      // Optimistic clear.
      if (myReq?.status === "pending") setMyReq(null);
      setMySubs((subs) => subs.filter((s) => s.status !== "pending"));
      try {
        if (latestSub?.status === "pending") await deleteMyPendingSubmission(latestSub.id);
        if (prevReq?.status === "pending") await cancelMyJoinRequest(game.id);
        toast("Request canceled.");
      } catch (e: any) {
        setMyReq(prevReq);
        setMySubs(prevSubs);
        toast.error(e.message ?? "Could not cancel.");
      } finally {
        refreshFlowStatus();
      }
      return;
    }
    // Signup window: started games, host-closed games and the host's blackout
    // window all block NEW joins. Payment for already-approved players is
    // handled above and stays available.
    if (gate.locked) {
      toast.error(gate.reason);
      return;
    }

    if (spotsLeft <= 0) {
      toast.error("This game is full.");
      return;
    }
    // Approval gate takes priority over payment: on games that require
    // approval, players must be approved before they can pay.
    if (requiresApproval && !isApproved) {
      // The settings row is optional: hosts who never opened game settings
      // still get request-to-join, so fall back to the game's host id.
      const requestHostId = settings?.host_id ?? game.hostUserId ?? null;
      if (!requestHostId) {
        toast.error("This host can't take requests yet.");
        return;
      }
      // Invite-link integrity: if the URL claims invite=1, `from` must be present
      // and must match the actual host. Otherwise the link is missing context or
      // has been tampered with — refuse to send the request.
      if (isInvite && (!inviteFrom || inviteFrom !== requestHostId)) {
        toast.error("This invite link is invalid or has been tampered with.");
        return;
      }
      // Client-side gate on resubmit: mirror the DB trigger so the user gets
      // an instant, human-readable message before the network round-trip.
      if (myReq?.status === "rejected") {
        if (capReached) {
          toast.error(
            `You've reached the ${JOIN_RESUBMIT_MAX_ATTEMPTS}-attempt limit for this game. Message the host instead.`,
          );
          return;
        }
        if (cooldownMs > 0) {
          toast.error(`Please wait ${formatCooldownLabel(cooldownMs)} before resubmitting.`);
          return;
        }
      }
      setRequesting(true);
      // Optimistic: flip CTA to "Request pending" immediately using a
      // synthetic row. Realtime `join_requests:me:*` reconciles with the
      // authoritative row on success; on server error we roll back.
      const prevReq = myReq;
      const optimistic: JoinRequest = {
        id: `optimistic:${crypto.randomUUID()}`,
        game_id: game.id,
        player_id: user?.id ?? "",
        host_id: requestHostId,
        status: "pending",
        message: null,
        reviewer_notes: null,
        created_at: new Date().toISOString(),
        reviewed_at: null,
      };
      setMyReq(optimistic);
      try {
        const wasRejected = prevReq?.status === "rejected";
        const created = await createJoinRequest({ game_id: game.id, host_id: requestHostId });
        // Swap synthetic row for the authoritative one.
        setMyReq(created);
        const isResubmit = wasRejected || (created.attempt_count ?? 1) > 1;
        // Fire notification off the critical path — failure must not stall the UI.
        void createNotification({
          user_id: requestHostId,
          type: isResubmit ? "join_resubmitted" : "join_request",
          title: isResubmit
            ? `Resubmitted request: ${game.title}`
            : `New request to join ${game.title}`,
          body: isResubmit
            ? "A player resubmitted their request — pending your review."
            : "Tap to review.",
          link: `/games/${game.id}`,
        }).catch(() => {});
        void saveMyGameReminderOffsets(game.id, reminderOffsets).catch(() => {});
        trackEvent("join_game", { game_id: game.id, kind: "request" });
        toast.success(
          isResubmit
            ? "Request resubmitted. The host will review it."
            : "Request sent. The host will review it.",
        );
      } catch (e: any) {
        setMyReq(prevReq);
        trackTaskError("request_to_join");
        toast.error(
          String(e?.message ?? "").includes("BLOCKED_BY_HOST")
            ? "You can't request to join this game."
            : (e.message ?? "Could not send request."),
        );
      } finally {
        setRequesting(false);
      }
      return;
    }
    if (isPaid) {
      const search: { invite?: true; from?: string } = {};
      if (isInvite) search.invite = true;
      if (inviteFrom) search.from = inviteFrom;
      const feeLabel = `$${Number(settings?.entry_fee ?? game.price ?? 0)
        .toFixed(2)
        .replace(/\.00$/, "")}`;
      toast.info(`Payment required to secure your spot`, {
        description: `Send ${feeLabel} to the host — your spot locks in once they verify.`,
        duration: 6000,
      });
      nav({ to: "/games/$gameId/pay", params: { gameId: game.id }, search });
      return;
    }
    // Wait for the server: a full roster, a closed game or a missing approval
    // answers with its own message, and neither the "You're in!" toast nor the
    // host's notification should go out for a join that did not happen.
    const joinedOk = await joinGame(game.id, preselectedPosition);
    if (!joinedOk) return;
    void saveMyGameReminderOffsets(game.id, reminderOffsets).catch(() => {});
    trackEvent("join_game", { game_id: game.id, kind: "instant" });
    toast.success(`You're in! See you at ${game.location}.`);
    // Notify host in real time that a new player joined.
    if (gameHostId && user && gameHostId !== user.id) {
      const who = myProfile?.name || emailLocalPart(user.email) || "A player";
      void createNotification({
        user_id: gameHostId,
        type: "participant_joined",
        title: `${who} joined ${game.title}`,
        body: `${effectiveJoined + 1}/${game.maxPlayers} players confirmed.`,
        link: `/games/${game.id}`,
      }).catch(() => {});
    }
  };

  const runJoin = async (preselectedPosition?: string) => {
    setProcessing(true);
    try {
      await executeJoinAction(preselectedPosition);
    } finally {
      setProcessing(false);
    }
  };

  // Physical-activity risk acknowledgment gate. Players see it once per
  // acknowledgment version per game; hosts and confirmed players skip it.
  const handleJoin = async (preselectedPosition?: string) => {
    const gate = needsRiskAcknowledgment({
      signedIn: !!user,
      isHost,
      // Taking back a pending request or payment is not joining: never ask for
      // the risk acknowledgment in front of it.
      alreadyJoined: viewerCountsAsJoined || isPending,
      acknowledgedVersion: riskAckVersion ?? null,
    });
    if (gate) {
      pendingJoinPositionRef.current = preselectedPosition ?? null;
      setRiskAckOpen(true);
      return;
    }
    await runJoin(preselectedPosition);
  };

  const confirmRiskAck = async () => {
    setProcessing(true);
    try {
      await recordSafetyAck({ gameId: game.id, kind: "participant_risk" });
      await refetchRiskAck();
      setRiskAckOpen(false);
      const pos = pendingJoinPositionRef.current ?? undefined;
      pendingJoinPositionRef.current = null;
      await executeJoinAction(pos);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't record your acknowledgment");
    } finally {
      setProcessing(false);
    }
  };

  const viewerPending =
    !isHost && requiresApproval && myReq?.status === "pending" && !viewerCountsAsJoined;
  const hostPendingReqs = isHost ? hostRequests.filter((r) => r.status === "pending") : [];
  const pendingCount = hostPendingReqs.length;
  // Real confirmed roster from `game_participants` (live via realtime).
  // Falls back to game.joined-sized placeholders during hydration so the
  // slot count never briefly collapses to zero.
  const meId = user?.id ?? null;
  const rosterOthers: RosterEntry[] = liveRoster
    .filter((p) => p.userId !== meId)
    .map((p) => ({
      kind: "player" as const,
      initials: p.avatarInitials,
      isMe: false,
      pending: false as const,
      userId: p.userId,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
    }));
  // Only show placeholder avatars while the live roster hasn't hydrated yet.
  // Once `liveParticipantCount` is defined we trust it as the authoritative
  // count, so a host removal that drops the roster to 0 doesn't leave ghost
  // avatars behind derived from the stale `game.joined` value.
  const rosterHydrated = liveParticipantCount !== undefined;
  const placeholderCount = rosterHydrated ? 0 : Math.max(0, (game.joined ?? 0) - liveRoster.length);
  const placeholderOthers: RosterEntry[] = Array.from({ length: placeholderCount }, (_, i) => ({
    kind: "player" as const,
    initials: ["MC", "AG", "JK", "RC", "TB", "SO", "PN", "DP", "EL", "VM"][i % 10],
    isMe: false,
    pending: false as const,
  }));
  const players: RosterEntry[] = [
    ...(viewerCountsAsJoined
      ? [
          {
            kind: "player" as const,
            initials: "YOU",
            isMe: true,
            pending: false as const,
            userId: meId ?? undefined,
          },
        ]
      : []),
    ...rosterOthers,
    ...placeholderOthers,
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

  const reportedHostId = settings?.host_id ?? game.hostUserId ?? null;

  return (
    <div className="pb-32">
      <RiskAcknowledgmentDialog
        open={riskAckOpen}
        onOpenChange={(v) => {
          setRiskAckOpen(v);
          if (!v) pendingJoinPositionRef.current = null;
        }}
        gameTitle={game.title}
        submitting={processing}
        onConfirm={() => void confirmRiskAck()}
      />

      {shareOpen && !game.isPrivate && (
        <ShareSheet
          content={buildGameShare(
            game,
            game.allDay ? formatWhenDate(game.date) : formatGameWhen(game),
            window.location.origin,
          )}
          open
          onOpenChange={setShareOpen}
        />
      )}

      {reportedHostId && (
        <ReportDialog
          open={reportGameOpen}
          onOpenChange={setReportGameOpen}
          subjectType="game"
          reportedId={reportedHostId}
          subjectLabel={game.title}
          gameId={game.id}
        />
      )}
      {/* Cancel game dialog (host) */}
      <Dialog
        open={cancelOpen}
        onOpenChange={(v) => {
          if (!cancelling) setCancelOpen(v);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel {game.title}?</DialogTitle>
            <DialogDescription>
              Everyone on the roster is notified right away and no one else can join. This can't be
              undone — you'd need to create a new game.
            </DialogDescription>
          </DialogHeader>
          <label
            className="block text-xs font-semibold text-muted-foreground"
            htmlFor="cancel-reason"
          >
            Reason players will see
          </label>
          <textarea
            id="cancel-reason"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={3}
            placeholder="Field flooded, not enough players, moved to next week…"
            className="w-full rounded-xl border border-border bg-background p-3 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCancelOpen(false)}
              disabled={cancelling}
              className="flex-1 rounded-xl border border-border bg-background py-2.5 text-xs font-semibold disabled:opacity-50"
            >
              Keep game
            </button>
            <button
              type="button"
              onClick={() => void handleCancelGame()}
              disabled={cancelling}
              className="flex-1 rounded-xl border border-coral/40 bg-coral/10 py-2.5 text-xs font-bold text-coral disabled:opacity-50"
            >
              {cancelling ? "Cancelling…" : "Cancel game"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Canonical lifecycle banner: cancelled or ended games say so first. */}
      {(() => {
        const resolved = resolveGameStatus(game);
        if (!resolved.terminal) return null;
        return (
          <div
            role="status"
            className={`mx-4 mt-4 flex items-start gap-2 rounded-2xl border p-3 text-xs font-semibold ${GAME_STATUS_TONE_CLASS[resolved.tone]}`}
          >
            <Ban className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="text-sm font-bold">{resolved.label}</div>
              <p className="mt-0.5 font-medium opacity-90">{resolved.detail}</p>
              {isHost ? (
                <Link
                  to="/create"
                  search={{ again: game.id }}
                  className="mt-2 inline-flex rounded-full bg-background px-3 py-1.5 text-xs font-bold text-foreground"
                >
                  Host this again
                </Link>
              ) : (
                <Link
                  to="/feed"
                  className="mt-2 inline-flex rounded-full bg-background px-3 py-1.5 text-xs font-bold text-foreground"
                >
                  Find another game
                </Link>
              )}
            </div>
          </div>
        );
      })()}

      {/* Hero */}
      <div className="relative h-72">
        <MediaImage src={game.image} alt={game.title} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-background/40" />
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
          <BackButton fallbackTo="/feed" variant="overlay" label="Back" />
          <div className="flex gap-2">
            {/* A private game is invite-only, so its link would lead nowhere for anyone else. */}
            {!game.isPrivate && (
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                aria-label="Share this game"
                className="grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur"
              >
                <Share2 className="h-4 w-4" />
              </button>
            )}
            {!isHost && reportedHostId && (
              <button
                onClick={() => setReportGameOpen(true)}
                aria-label="Report game"
                className="grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur"
              >
                <Flag className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="absolute bottom-4 left-4 right-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-background/70 backdrop-blur px-3 py-1 text-xs font-semibold">
              {emojiBySport[game.sport]} {game.sport}
            </span>
            <span className="rounded-full bg-background/70 backdrop-blur px-3 py-1 text-xs font-semibold">
              {formatSkillValue(game.sport, game.skill)}
            </span>
            {hasAgeRequirement(ageReq) && (
              <span className="rounded-full bg-background/70 backdrop-blur px-3 py-1 text-xs font-semibold">
                🎂 {ageRequirementLabel(ageReq)}
              </span>
            )}
            {game.urgent && spotsLeft > 0 && (
              <span className="rounded-full bg-coral-gradient px-3 py-1 text-xs font-bold text-white">
                ⚡ {spotsLeft} spots left
              </span>
            )}
          </div>
          <h1 className="page-title drop-shadow-lg">{game.title}</h1>
        </div>
      </div>

      {/* Multi-day series: switch between sessions */}
      {game.seriesId && (
        <div className="page-shell mt-4">
          <SeriesSessionsStrip game={game} />
        </div>
      )}

      {/* Tabs: Overview / Payments */}
      {isPaid && (
        <div className="page-shell mt-4">
          <div className="flex gap-1 rounded-full border border-border bg-surface p-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              className={`flex-1 rounded-full px-3 py-2 font-semibold transition ${
                activeTab === "overview"
                  ? "bg-lime text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("payments")}
              className={`flex-1 rounded-full px-3 py-2 font-semibold transition inline-flex items-center justify-center gap-1.5 ${
                activeTab === "payments"
                  ? "bg-lime text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Payments
              {isHost && pendingCount > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-coral-strong px-1.5 text-[10px] font-bold text-white min-w-[18px] h-[18px]">
                  {pendingCount}
                </span>
              )}
              {!isHost && latestSub && latestSub.status !== "verified" && (
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    latestSub.status === "rejected" ? "bg-coral" : "bg-amber-400"
                  }`}
                  aria-hidden
                />
              )}
            </button>
          </div>
        </div>
      )}

      {isPaid && activeTab === "payments" && (
        <div className="page-shell mt-4">
          {isHost ? (
            <HostPaymentsPanel gameId={game.id} gameTitle={game.title} settings={settings} />
          ) : (
            <PlayerPaymentsPanel gameId={game.id} settings={settings} />
          )}
        </div>
      )}

      <div
        className={`page-shell mt-5 space-y-5 ${isPaid && activeTab !== "overview" ? "hidden" : ""}`}
      >
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
                  {requiresApproval ? "“Request Spot”" : isPaid ? "“Pay Host”" : "“Join Run”"} below
                  to confirm your spot.
                </p>
              </div>
            </div>
          ))}

        {/* Refund status for a payment the refund policy has been applied to. */}
        {!isHost &&
          (() => {
            const r = mySubs.find(
              (x) =>
                x.refund_status === "owed" ||
                x.refund_status === "refunded" ||
                x.refund_status === "kept",
            );
            if (!r) return null;
            const amt = `$${Number(r.refund_amount ?? 0).toFixed(2)}`;
            const copy =
              r.refund_status === "owed"
                ? {
                    title: `Refund owed to you · ${amt}`,
                    body: "The host has been told. They send it back directly in their payment app — BallaCity doesn't hold money.",
                    cls: "border-amber-500/40 bg-amber-500/10",
                  }
                : r.refund_status === "refunded"
                  ? {
                      title: `Refund sent · ${amt}`,
                      body: "The host marked your refund as sent. Check your payment app; if it hasn't arrived, message the host.",
                      cls: "border-lime/40 bg-lime/10",
                    }
                  : {
                      title: "Fee not refunded",
                      body: "Under the host's refund policy, this fee was kept.",
                      cls: "border-border bg-surface",
                    };
            return (
              <div
                className={`rounded-2xl border p-4 ${copy.cls}`}
                role="status"
                aria-live="polite"
              >
                <div className="font-display text-sm font-bold">{copy.title}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">{copy.body}</p>
              </div>
            );
          })()}

        {/* Payment-required banner (shows when approved-but-unpaid or payment rejected) */}
        {!isHost && (
          <PaymentRequiredBanner
            gameId={gameId}
            settings={flowSettings ?? settings}
            status={myFlowStatus}
          />
        )}

        {/* Compact flow status pill for the viewer */}
        {!isHost && myFlowStatus !== "none" && (
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold uppercase tracking-wider text-muted-foreground">
              Your status
            </span>
            <PlayerFlowPill status={myFlowStatus} />
          </div>
        )}

        <GameApprovalBanner
          capReached={capReached}
          cooldownMs={cooldownMs}
          fee={fee}
          game={game}
          isHost={isHost}
          isPaid={isPaid}
          isPaymentVerified={isPaymentVerified}
          myFlowStatus={myFlowStatus}
          myHoldLabel={myHoldLabel}
          myReq={myReq}
          myWait={myWait}
          refreshStatus={refreshStatus}
          requiresApproval={requiresApproval}
        />

        {/* Compact "Your status" strip for paid games — driven by shared flow
            status so it never disagrees with the banner above. Shown for any
            paid-flow state so an approved-but-unpaid player sees "Payment due"
            here too, not just after they've submitted proof. */}
        {!isHost &&
          isPaid &&
          (() => {
            const stripCopy: Partial<
              Record<string, { text: string; tone: "warn" | "info" | "ok" | "bad" }>
            > = {
              payment_pending: {
                text: myHoldLabel
                  ? `Approved · Pay host directly to lock your spot · ⏳ ${myHoldLabel}`
                  : "Approved · Pay host directly to lock your spot",
                tone: "warn",
              },
              payment_submitted: {
                text: "Proof sent · Awaiting host confirmation",
                tone: "info",
              },
              payment_rejected: {
                text: "Payment declined by host · Resubmit proof or message host",
                tone: "bad",
              },
              payment_verified: { text: "You're in! Payment confirmed", tone: "ok" },
              confirmed: { text: "You're in! Payment confirmed", tone: "ok" },
            };
            const entry = stripCopy[myFlowStatus];
            if (!entry) return null;
            const toneClass =
              entry.tone === "ok"
                ? "border-lime/40 bg-lime/10 text-lime"
                : entry.tone === "warn"
                  ? "border-coral/40 bg-coral/10 text-coral"
                  : entry.tone === "info"
                    ? "border-lime/30 bg-lime/5 text-lime"
                    : "border-destructive/50 bg-destructive/10 text-destructive";
            return (
              <div
                className={`flex items-center gap-3 rounded-2xl border px-4 py-2.5 text-xs ${toneClass}`}
                role="status"
                aria-live="polite"
                data-testid="your-status-strip"
                data-status={myFlowStatus}
              >
                <span className="font-bold uppercase tracking-wider">Your status</span>
                <span className="text-foreground/80">·</span>
                <span className="font-semibold">{entry.text}</span>
              </div>
            );
          })()}

        {/* Policies + host trust — visible before any join action */}
        {!isHost && <GamePolicySummary policy={viewerPolicy} defaultOpen />}
        <HostTrustPanel trust={hostTrust} hostName={game.host.name} />

        {/* Meta */}
        <div className="grid grid-cols-2 gap-2">
          <Meta
            icon={<Clock className="h-4 w-4 text-lime" />}
            label="Starts"
            value={game.allDay ? formatWhenDate(game.date) : formatGameWhen(game)}
          />
          <Meta
            icon={<Calendar className="h-4 w-4 text-lime" />}
            label="Ends"
            value={formatEndsAt(game)}
          />
          <Meta
            icon={<Users className="h-4 w-4 text-coral" />}
            label="Players"
            value={`${effectiveJoined} / ${game.maxPlayers}`}
          />
          <Meta
            icon={<MapPin className="h-4 w-4 text-coral" />}
            label="Distance"
            value={<GameDistance game={game} />}
          />
        </div>

        <div className="flex justify-end">
          <AddToCalendarButton
            event={{
              title: game.title,
              start: game.date,
              end: new Date(gameEndsAt(game)).toISOString(),
              allDay: !!game.allDay,
              timezone: game.timezone ?? null,
              location: [game.location, game.neighborhood].filter(Boolean).join(", "),
              description: game.description ?? undefined,
              mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                [game.location, game.neighborhood].filter(Boolean).join(", "),
              )}`,
              url: typeof window !== "undefined" ? window.location.href : undefined,
              uid: `game-${game.id}@ballacity`,
            }}
          />
        </div>

        {viewerCountsAsJoined && <GameReminderCard gameId={game.id} />}

        <GameLocationCard game={game} />

        <GameHostSection
          canReviewHost={canReviewHost}
          game={game}
          hostRep={hostRep}
          hostTeam={hostTeam}
          ownsViaGame={ownsViaGame}
          reviewsOpen={reviewsOpen}
          setReviewsOpen={setReviewsOpen}
          settings={settings}
        />

        {/* About */}
        <div>
          <h2 className="section-eyebrow text-muted-foreground mb-2">About the run</h2>
          <p className="text-sm leading-relaxed">{game.description}</p>
          {/* Safety: risk notice + safety reporting entry point */}
          <div className="mt-3 rounded-2xl border border-border bg-surface px-4 py-3">
            <div className="flex items-center gap-2 section-eyebrow text-muted-foreground">
              <ShieldAlert className="h-4 w-4 text-lime" aria-hidden /> Safety
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              {RISK_ACKNOWLEDGMENT.text} Games are organized by the host — BallaCity does not
              supervise play or inspect venues.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to="/safety"
                className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold"
              >
                Safety Center
              </Link>
              {!isHost && reportedHostId && (
                <button
                  type="button"
                  onClick={() => setReportGameOpen(true)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-destructive"
                >
                  Report a safety issue
                </button>
              )}
            </div>
          </div>

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

        {/* Discussion */}
        <div>
          <h2 className="section-eyebrow text-muted-foreground mb-2">Discussion</h2>
          <PostEngagement subjectType="game" subjectId={game.id} />
        </div>

        <GamePaymentTerms
          game={game}
          isPaid={isPaid}
          refundTerms={refundTerms}
          settings={settings}
        />

        {/* Positions needed */}
        {game.positionsNeeded && Object.keys(game.positionsNeeded).length > 0 && (
          <div id="waitlist" className="scroll-mt-24">
            <div className="flex items-center justify-between mb-2">
              <h2 className="section-eyebrow text-muted-foreground">Positions needed</h2>
              <button
                type="button"
                onClick={() => setPositionRosterOpen(true)}
                className="text-xs font-semibold text-lime hover:underline"
                aria-label="View roster by position"
              >
                View roster
              </button>
            </div>
            {viewerGate.waitlistOpen && (
              <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
                {viewerGate.reason} You can still join a waitlist below: pick the position you want
                and your name is listed there as “waiting”. Waitlist spots appear on this position
                chip for everyone, and the host pulls from it when a spot frees up.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {Object.entries(game.positionsNeeded).map(([name, count]) => {
                const filled = liveRoster.filter((p) => p.position === name).length;
                const remaining = Math.max(0, count - filled);
                const isFull = remaining === 0;
                const posWaitlist = waitlistEntries.filter((w) => w.position === name);
                const viewerOnWaitlist = !!user && posWaitlist.some((w) => w.userId === user.id);
                const canJoinAs =
                  !isParentMode &&
                  !isFull &&
                  !isHost &&
                  !isConfirmed &&
                  !joined &&
                  !isPending &&
                  !requiresApproval &&
                  !isPaid &&
                  !gate.locked &&
                  spotsLeft > 0 &&
                  !!user;
                const canWaitlist =
                  !isParentMode &&
                  (isFull || viewerGate.waitlistOpen) &&
                  !isHost &&
                  !isConfirmed &&
                  !joined &&
                  viewerGate.waitlistOpen &&
                  !!user;
                return (
                  <div key={name} className="inline-flex items-center gap-1">
                    <span
                      className={
                        isFull
                          ? "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-muted-foreground line-through"
                          : "inline-flex items-center gap-1.5 rounded-full border border-lime/40 bg-lime/10 px-3 py-1 text-xs font-semibold text-lime"
                      }
                      aria-label={
                        isFull
                          ? `${name}: filled, ${posWaitlist.length} on waitlist`
                          : `${name}: ${remaining} of ${count} spots remaining`
                      }
                    >
                      <span>{name}</span>
                      <span
                        className={
                          isFull
                            ? "rounded-full bg-secondary px-1.5 py-0.5 text-[10px] tabular-nums"
                            : "rounded-full bg-lime/20 px-1.5 py-0.5 text-[10px] tabular-nums"
                        }
                      >
                        {isFull ? "Filled" : `${remaining} of ${count} left`}
                      </span>
                      {isFull && posWaitlist.length > 0 && (
                        <span className="rounded-full bg-coral/20 px-1.5 py-0.5 text-[10px] font-semibold text-coral tabular-nums normal-case">
                          {posWaitlist.length} waiting
                        </span>
                      )}
                    </span>
                    {canJoinAs && (
                      <button
                        type="button"
                        disabled={processing}
                        onClick={() => {
                          void leaveWaitlist(game.id, name).catch(() => {});
                          handleJoin(name);
                        }}
                        aria-label={`Join as ${name}`}
                        className="rounded-full border border-lime bg-lime px-2.5 py-1 text-[11px] font-bold text-background hover:opacity-90 active:scale-95 transition disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        Join as {name}
                      </button>
                    )}
                    {canWaitlist && !viewerOnWaitlist && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await joinWaitlist(game.id, name);
                            toast.success(`You're on the ${name} waitlist.`);
                            const gameHostId = settings?.host_id ?? game.hostUserId ?? null;
                            if (gameHostId && user && gameHostId !== user.id) {
                              const who =
                                myProfile?.name || emailLocalPart(user.email) || "A player";
                              void createNotification({
                                user_id: gameHostId,
                                type: "waitlist_join",
                                title: `${who} joined the ${name} waitlist`,
                                body: `${game.title}`,
                                link: `/games/${game.id}`,
                              }).catch(() => {});
                            }
                          } catch (e: any) {
                            toast.error(e.message ?? "Could not join waitlist.");
                          }
                        }}
                        aria-label={`Join ${name} waitlist`}
                        className="rounded-full border border-coral/60 bg-coral/10 px-2.5 py-1 text-[11px] font-bold text-coral hover:bg-coral/20 active:scale-95 transition"
                      >
                        Join waitlist
                      </button>
                    )}
                    {viewerOnWaitlist &&
                      !isHost &&
                      (() => {
                        const mineHere = posWaitlist.find((w) => w.userId === user!.id);
                        return mineHere && mineHere.status !== "waiting" ? (
                          <WaitlistStatusPill status={mineHere.status} />
                        ) : null;
                      })()}
                    {viewerOnWaitlist && !isHost && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await leaveWaitlist(game.id, name);
                            toast(`Removed from the ${name} waitlist.`);
                          } catch (e: any) {
                            toast.error(e.message ?? "Could not leave waitlist.");
                          }
                        }}
                        aria-label={`Leave ${name} waitlist`}
                        className="rounded-full border border-coral bg-coral px-2.5 py-1 text-[11px] font-bold text-background hover:opacity-90 active:scale-95 transition"
                      >
                        Leave waitlist
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {(() => {
              if (!user || isHost) return null;
              const mine = waitlistEntries.filter((w) => w.userId === user.id);
              if (mine.length === 0) return null;
              return (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-coral/40 bg-coral/5 px-3 py-2">
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    You’re on the waitlist for{" "}
                    <span className="font-semibold text-foreground">
                      {mine.map((w) => w.position).join(", ")}
                    </span>
                    . We’ll notify you if a spot opens up.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await Promise.all(mine.map((w) => leaveWaitlist(game.id, w.position)));
                        toast(
                          mine.length > 1
                            ? "Removed from all waitlists for this game."
                            : `Removed from the ${mine[0]!.position} waitlist.`,
                        );
                      } catch (e: any) {
                        toast.error(e.message ?? "Could not leave waitlist.");
                      }
                    }}
                    aria-label={mine.length > 1 ? "Leave all waitlists" : "Leave waitlist"}
                    className="rounded-full border border-coral bg-coral px-3 py-1.5 text-[11px] font-bold text-background hover:opacity-90 active:scale-95 transition"
                  >
                    {mine.length > 1 ? "Leave all waitlists" : "Leave waitlist"}
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        <Sheet open={positionRosterOpen} onOpenChange={setPositionRosterOpen}>
          <SheetContent side="right" className="w-[min(100%,28rem)] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Roster by position</SheetTitle>
              <SheetDescription>
                {effectiveJoined}/{game.maxPlayers} confirmed
                {game.positionsNeeded && Object.keys(game.positionsNeeded).length > 0
                  ? " — grouped by role"
                  : null}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {Object.entries(game.positionsNeeded ?? {}).map(([name, count]) => {
                const filledPlayers = liveRoster.filter((p) => p.position === name);
                const remaining = Math.max(0, count - filledPlayers.length);
                const isFull = remaining === 0;
                const posWait = waitlistEntries.filter((w) => w.position === name);
                return (
                  <div key={name} className="rounded-2xl border border-border bg-surface p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-display font-bold">{name}</div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                          isFull ? "bg-secondary text-muted-foreground" : "bg-lime/20 text-lime"
                        }`}
                      >
                        {isFull ? "Filled" : `${remaining} of ${count} left`}
                      </span>
                    </div>
                    {filledPlayers.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No one confirmed yet.</div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {filledPlayers.map((p) => (
                          <div key={p.userId} className="flex items-center gap-2">
                            <UserAvatar
                              name={p.displayName}
                              initials={p.avatarInitials}
                              avatarUrl={p.avatarUrl}
                              size="sm"
                            />
                            <span className="text-sm">{p.displayName}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <WaitlistManager
                      entries={posWait}
                      isHost={isHost}
                      gameTitle={game.title}
                      gameId={game.id}
                      spotsLeft={remaining}
                    />
                  </div>
                );
              })}

              {(() => {
                const namedPositions = new Set(Object.keys(game.positionsNeeded ?? {}));
                const unassigned = liveRoster.filter(
                  (p) => !p.position || !namedPositions.has(p.position),
                );
                if (unassigned.length === 0) return null;
                return (
                  <div className="rounded-2xl border border-dashed border-border bg-surface p-3">
                    <div className="font-display font-bold mb-2">Unassigned</div>
                    <div className="flex flex-col gap-2">
                      {unassigned.map((p) => (
                        <div key={p.userId} className="flex items-center gap-2">
                          <UserAvatar
                            name={p.displayName}
                            initials={p.avatarInitials}
                            avatarUrl={p.avatarUrl}
                            size="sm"
                          />
                          <span className="text-sm">{p.displayName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </SheetContent>
        </Sheet>

        <GamePlayersSection
          applyOptimisticReview={applyOptimisticReview}
          effectiveJoined={effectiveJoined}
          game={game}
          isHost={isHost}
          liveRoster={liveRoster}
          meId={meId}
          pendingCount={pendingCount}
          players={players}
          spotsLeft={spotsLeft}
          viewerPending={viewerPending}
        />
      </div>

      {/* Host controls */}
      {isHost && (
        <div
          className={`page-shell mt-4 space-y-3 ${isPaid && activeTab !== "overview" ? "hidden" : ""}`}
        >
          {!game.cancelledAt &&
            game.status !== "cancelled" &&
            !game.completedAt &&
            Math.abs(new Date(game.date).getTime() - Date.now()) < 24 * 60 * 60 * 1000 && (
              <GameDayActionSheet
                gameId={game.id}
                gameTitle={game.title}
                startsAt={game.date}
                isPaid={isPaid}
                fee={fee}
                hostId={user?.id ?? ""}
                roster={liveRoster}
                approvedPlayerIds={hostRequests
                  .filter((r) => r.status === "approved")
                  .map((r) => r.player_id)}
                busyId={attendanceBusy}
                onMarkAttendance={(id, v) => void handleAttendance(id, v)}
              />
            )}
          {/* Manage game: edit, start, close joining */}
          <div className="rounded-2xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-sm">Manage game</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {gate.joinState === "in_progress"
                    ? "In progress — signups locked."
                    : gate.joinState === "completed"
                      ? "This game has ended."
                      : gate.joinState === "closed_by_host"
                        ? "Joining is closed. Reopen to accept more players."
                        : gate.joinState === "closed_cutoff"
                          ? gate.reason
                          : "Edit details, start the game, or close joining when full."}
                </p>
              </div>
              <span
                className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-1 micro-label ${
                  gate.joinState === "in_progress"
                    ? "bg-coral/15 text-coral border border-coral/40"
                    : gate.joinState === "completed"
                      ? "bg-secondary text-muted-foreground border border-border"
                      : gate.locked
                        ? "bg-secondary text-muted-foreground border border-border"
                        : "bg-lime/15 text-lime border border-lime/40"
                }`}
              >
                {gate.joinState === "in_progress"
                  ? "In progress"
                  : gate.joinState === "completed"
                    ? "Ended"
                    : gate.locked
                      ? "Signup closed"
                      : "Scheduled"}
              </span>
            </div>
            <div className="mt-3">
              <label
                htmlFor="signup-cutoff"
                className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Signup cutoff
              </label>
              <select
                id="signup-cutoff"
                value={String(game.signupCutoffMin ?? 0)}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0;
                  void updateHostedGame(game.id, { signupCutoffMin: v } as never).then(
                    () =>
                      toast.success(
                        v > 0
                          ? `Signups will close ${cutoffAmountLabel(v)} before start.`
                          : "Signup cutoff turned off.",
                      ),
                    () => toast.error("Couldn't save the signup cutoff. Try again."),
                  );
                }}
                disabled={gate.joinState === "completed"}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
              >
                {SIGNUP_CUTOFF_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                New signups stop automatically this long before kickoff. Approved players can still
                pay.
              </p>
            </div>
            <div className="mt-3">
              <label
                htmlFor="cancel-cutoff"
                className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Cancellation cutoff
              </label>
              <select
                id="cancel-cutoff"
                value={String(normalizeCutoff(game.cancelCutoffMin))}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0;
                  void updateHostedGame(game.id, { cancelCutoffMin: v } as never).catch(() => {});
                  toast.success(
                    v > 0
                      ? `Cancellations within ${cutoffAmountLabel(v)} of start will count as late.`
                      : "Players can cancel any time without a late mark.",
                  );
                }}
                disabled={gate.joinState === "completed"}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
              >
                {CANCEL_CUTOFF_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Players can still cancel after this, but it's recorded as a late cancellation and
                counts against their reliability like a no-show.
              </p>
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
                    // Completion goes through the RPC so the database stamps
                    // completed_at, locks joins and opens attendance marking.
                    void (async () => {
                      try {
                        await completeGame(game.id);
                        await updateHostedGame(game.id, {
                          status: "completed",
                          completedAt: new Date().toISOString(),
                          joinsClosed: true,
                        });
                        toast.success("Game marked as ended. You can now mark attendance.");
                      } catch (err) {
                        toast.error(
                          (err as { message?: string })?.message ?? "Couldn't end this game.",
                        );
                      }
                    })();
                  } else {
                    void updateHostedGame(game.id, {
                      status: "in_progress",
                      joinsClosed: true,
                    }).catch(() => {});
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
                  void updateHostedGame(game.id, { joinsClosed: next }).catch(() => {});
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
            {!game.isPrivate ? (
              <div className="mt-2">
                <ListingVisibilityToggle kind="game" id={game.id} />
              </div>
            ) : (
              <p className="mt-2 rounded-xl border border-border bg-background px-3 py-2 text-[11px] text-muted-foreground">
                Private game: only people you invite can see it. Invite players from their
                availability card on the{" "}
                <Link to="/players" className="font-semibold underline">
                  Players tab
                </Link>
                .
              </p>
            )}
            {!game.cancelledAt && game.status !== "cancelled" ? (
              <button
                type="button"
                onClick={() => setCancelOpen(true)}
                disabled={game.status === "completed" || !!game.completedAt}
                className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 py-2.5 text-xs font-bold disabled:opacity-50"
              >
                <Ban className="h-4 w-4" /> Cancel game
              </button>
            ) : null}
            {(() => {
              // Deleting removes the game without telling anyone; once players are in,
              // Cancel is the one that notifies them (and handles refunds).
              const hasPlayers =
                liveRoster.length > 0 ||
                (liveParticipantCount ?? 0) > 0 ||
                (game.joined ?? 0) > 0 ||
                hostRequests.some((r) => r.status === "approved");
              return (
                <>
                  <button
                    type="button"
                    disabled={hasPlayers}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          "Delete this game for good? Nobody has joined yet. This can't be undone.",
                        )
                      )
                        return;
                      try {
                        await deleteHostedGame(game.id);
                        toast.success("Game deleted.");
                        nav({ to: "/feed", replace: true });
                      } catch {
                        toast.error("Couldn't delete this game.");
                      }
                    }}
                    className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-coral/40 bg-coral/10 text-coral py-2.5 text-xs font-bold disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" /> Delete game
                  </button>
                  {hasPlayers ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Players are signed up, so this game can only be cancelled. Cancelling tells
                      everyone on the roster.
                    </p>
                  ) : null}
                </>
              );
            })()}
          </div>

          {hostRequests.length > 0 ? (
            <div>
              <h2 className="section-eyebrow text-muted-foreground mb-2">
                Pickup requests · {hostRequests.filter((r) => r.status === "pending").length}{" "}
                pending
              </h2>
              <div className="space-y-2">
                {hostRequests.map((r) => (
                  <HostRequestRow
                    key={r.id}
                    req={r}
                    ageReq={ageReq}
                    gameTitle={game.title}
                    onOptimistic={applyOptimisticReview}
                    guardian={guardianNeedByRequest.get(r.id)}
                  />
                ))}
              </div>
            </div>
          ) : requiresApproval ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-3 text-xs text-muted-foreground">
              No pickup requests yet. You'll see them here as players ask to join.
            </div>
          ) : null}

          {/* Roster (host view) */}
          <div>
            {(() => {
              // Only surface approved join_requests whose player is still on
              // the live roster. Once liveRoster hydrates, any join_request
              // whose participant row was removed (host action, cleanup)
              // stops rendering immediately — this was the "roster still
              // shows removed player" bug.
              const liveIds = new Set(liveRoster.map((p) => p.userId));
              const rosterHydrated = liveRoster.length > 0 || (liveParticipantCount ?? 0) === 0;
              const approvedReqs = hostRequests
                .filter((r) => r.status === "approved")
                .filter((r) => (rosterHydrated ? liveIds.has(r.player_id) : true));
              const approvedIds = new Set(approvedReqs.map((r) => r.player_id));
              // On a paid game a player isn't a participant until their payment
              // is verified, so an approved-but-unpaid player is (correctly)
              // missing from the live roster. Show them in their own group so
              // the host can see who still owes the fee and nudge them, without
              // counting them as confirmed.
              const awaitingPaymentReqs =
                isPaid && rosterHydrated
                  ? hostRequests
                      .filter((r) => r.status === "approved")
                      .filter((r) => !liveIds.has(r.player_id))
                  : [];
              // Realtime participants that aren't already surfaced via an
              // approved join request. Falls back to placeholder rows only
              // while hydrating and the cached count says there should be
              // players.
              const rosterFromLive = liveRoster.filter((p) => !approvedIds.has(p.userId));
              const fallbackPlaceholderCount =
                liveRoster.length === 0 ? (liveParticipantCount ?? game.joined ?? 0) : 0;
              const totalConfirmed =
                approvedReqs.length + Math.max(rosterFromLive.length, fallbackPlaceholderCount);
              return (
                <>
                  <h2 className="section-eyebrow text-muted-foreground mb-2">
                    Roster · {totalConfirmed} / {game.maxPlayers}
                  </h2>

                  {/* Attendance: host-only, opens at start time. Feeds the
                      host's real attendance rate on the trust panel. */}
                  {isHost &&
                  !game.cancelledAt &&
                  liveRoster.length > 0 &&
                  Date.now() >= new Date(game.date).getTime() ? (
                    <div className="mb-3 rounded-2xl border border-border bg-surface p-3">
                      <div className="section-eyebrow text-muted-foreground">Attendance</div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Mark who showed up. This builds your host reliability score.
                      </p>
                      <div className="mt-2 space-y-1.5">
                        {liveRoster.map((p) => (
                          <div key={`att-${p.userId}`} className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                              {p.displayName}
                            </span>
                            <button
                              type="button"
                              aria-label={`Mark ${p.displayName} present`}
                              aria-pressed={p.attended === true}
                              disabled={attendanceBusy === p.userId}
                              onClick={() => void handleAttendance(p.userId, true)}
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 ${
                                p.attended === true
                                  ? "border-lime/40 bg-lime/10 text-lime"
                                  : "border-border bg-background text-muted-foreground"
                              }`}
                            >
                              <UserCheck className="h-3.5 w-3.5" /> Present
                            </button>
                            <button
                              type="button"
                              aria-label={`Mark ${p.displayName} as a no-show`}
                              aria-pressed={p.attended === false}
                              disabled={attendanceBusy === p.userId}
                              onClick={() => void handleAttendance(p.userId, false)}
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 ${
                                p.attended === false
                                  ? "border-coral/40 bg-coral/10 text-coral"
                                  : "border-border bg-background text-muted-foreground"
                              }`}
                            >
                              <UserX className="h-3.5 w-3.5" /> No-show
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    {totalConfirmed === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-3 text-xs text-muted-foreground">
                        No confirmed players yet.
                      </div>
                    ) : (
                      <>
                        {approvedReqs.map((r) => (
                          <RosterPlayerRow
                            key={r.id}
                            req={r}
                            gameTitle={game.title}
                            feeRequired={isPaid}
                            fee={fee}
                            holdMinutes={settings?.payment_hold_minutes ?? null}
                            gameStartsAt={game.date}
                            onOptimistic={applyOptimisticReview}
                          />
                        ))}
                        {rosterFromLive.map((p) => {
                          const canRemove = isHost && user && p.userId !== user.id;
                          const isRemoving = removingId === p.userId;
                          return (
                            <div
                              key={`live-${p.userId}`}
                              className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3"
                            >
                              <Link
                                to="/players/$userId"
                                params={{ userId: p.userId }}
                                className="flex flex-1 items-center gap-3 min-w-0 hover:opacity-90"
                              >
                                <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-secondary text-xs font-bold">
                                  {p.avatarUrl ? (
                                    <img
                                      src={p.avatarUrl}
                                      alt={p.displayName}
                                      className="h-full w-full object-cover"
                                      loading="lazy"
                                    />
                                  ) : (
                                    p.avatarInitials
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-semibold truncate">
                                    {p.displayName}
                                  </div>
                                  <div className="text-[11px] text-muted-foreground">
                                    Joined {new Date(p.joinedAt).toLocaleString()}
                                  </div>
                                </div>
                              </Link>
                              {canRemove ? (
                                <button
                                  type="button"
                                  aria-label={`Remove ${p.displayName} from roster`}
                                  disabled={isRemoving}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setRemoveTarget({ userId: p.userId, name: p.displayName });
                                  }}
                                  className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground hover:border-coral/60 hover:text-coral disabled:opacity-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                            </div>
                          );
                        })}

                        {Array.from({ length: fallbackPlaceholderCount }).map((_, i) => (
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
                                Loading roster…
                              </div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>

                  {awaitingPaymentReqs.length > 0 && (
                    <div className="mt-4">
                      <h2 className="section-eyebrow text-amber-500 mb-2">
                        Awaiting payment · {awaitingPaymentReqs.length}
                      </h2>
                      <p className="mb-2 text-[11px] text-muted-foreground">
                        Approved, but their spot isn't locked until you confirm their payment.
                      </p>
                      <div className="space-y-2">
                        {awaitingPaymentReqs.map((r) => (
                          <RosterPlayerRow
                            key={r.id}
                            req={r}
                            gameTitle={game.title}
                            feeRequired={isPaid}
                            fee={fee}
                            holdMinutes={settings?.payment_hold_minutes ?? null}
                            gameStartsAt={game.date}
                            onOptimistic={applyOptimisticReview}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Sticky CTA */}
      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+6rem)] left-0 right-0 z-30 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur-xl bg-background/80 border-t border-border">
        <div className="mx-auto w-[min(100%,28rem)]">
          {!isParentMode && !isHost && !joined && !isPending && !isConfirmed && !isApproved && (
            <JoinBlockedReason gate={viewerGate} className="mb-2" waitlistHint />
          )}
          {ageNotice && !isConfirmed && !isApproved && (
            <p className="mb-2 text-[11px] font-medium text-muted-foreground" role="status">
              🎂 {ageNotice}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              disabled={messaging || !messagingDecision.allowed}
              aria-label="Message the host"
              onClick={async () => {
                if (!user) {
                  nav({ to: "/auth" });
                  return;
                }
                if (!messagingDecision.allowed) {
                  toast.error(
                    messagingDecision.reason ||
                      "A parent or guardian must approve this account first.",
                  );
                  return;
                }
                // game_payment_settings is readable only by the host and by
                // players already linked to the game (approved join request,
                // payment submission, or participant row). A prospective
                // player browsing the game matches none of those, so RLS
                // filters the row out silently and `settings` stays null —
                // which is exactly the person this button exists for. Fall
                // back to hosted_games.host_id, which the viewer *can* read,
                // the way the other nine host_id reads in this file do.
                const hostUid = settings?.host_id ?? game.hostUserId ?? null;
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
                  toast.error(describeMessagingError(e, undefined, "host"));
                } finally {
                  setMessaging(false);
                }
              }}
              className="grid h-12 w-12 place-items-center rounded-2xl border border-border bg-surface disabled:opacity-50"
            >
              <MessageCircle className="h-5 w-5" />
            </button>
            {!isParentMode &&
              !isHost &&
              (() => {
                // Locked games (started / host-closed / inside the blackout window)
                // block NEW joins, but keep leave/cancel and payment actions live.
                const lockedForNewJoin =
                  gate.locked && !joined && !isPending && !isConfirmed && !isApproved;
                const alreadyInFlow = joined || isPending || isConfirmed;
                // A parent/guardian must approve this account before a NEW
                // join; leaving/withdrawing a join made before consent was
                // revoked stays available.
                const consentBlocksNewJoin = !alreadyInFlow && !participationDecision.allowed;
                const canJoinAction = alreadyInFlow || spotsLeft > 0;
                const waitlistCta =
                  spotsLeft <= 0 &&
                  !alreadyInFlow &&
                  !lockedForNewJoin &&
                  !consentBlocksNewJoin &&
                  viewerGate.waitlistOpen;
                const buttonDisabled =
                  requesting ||
                  processing ||
                  (!canJoinAction && !waitlistCta) ||
                  lockedForNewJoin ||
                  consentBlocksNewJoin;
                const hasPaymentAttempt =
                  latestSub?.status === "pending" || latestSub?.status === "rejected";
                const canEnterPaymentFlow =
                  spotsLeft > 0 || joined || hasPaymentAttempt || isApproved;
                const paymentAction =
                  isPaid && !paymentCleared && approvalCleared && canEnterPaymentFlow;
                const paymentSearch: { invite?: true; from?: string } = {};
                if (isInvite) paymentSearch.invite = true;
                if (inviteFrom) paymentSearch.from = inviteFrom;
                const paymentCtaLabel =
                  latestSub?.status === "pending"
                    ? "Payment pending · View status"
                    : latestSub?.status === "rejected"
                      ? "Payment rejected · Pay again"
                      : `Pay Host · $${fee.toFixed(2)}`;
                const LiveSpots = () => (
                  <span
                    className="inline-flex items-baseline"
                    aria-live="polite"
                    aria-atomic="true"
                    aria-label={`${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`}
                  >
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={spotsLeft}
                        initial={{ y: -6, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 6, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="tabular-nums"
                      >
                        {spotsLeft}
                      </motion.span>
                    </AnimatePresence>
                    <span className="ml-1">spot{spotsLeft === 1 ? "" : "s"} left</span>
                  </span>
                );
                if (myWait?.onParent && !myWait.onHost) {
                  return (
                    <div className="flex-1">
                      <button
                        type="button"
                        disabled
                        aria-disabled
                        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-coral/40 bg-surface py-3.5 font-bold text-coral opacity-80"
                      >
                        <Clock className="h-4 w-4" /> Waiting for your parent
                      </button>
                      <div className="mt-1.5 text-center">
                        <LeaveFlowButton gameId={game.id} gameTitle={game.title} variant="link" />
                      </div>
                    </div>
                  );
                }
                if (paymentAction) {
                  return (
                    <motion.div whileTap={{ scale: 0.97 }} className="flex-1">
                      <Link
                        to="/games/$gameId/pay"
                        params={{ gameId: game.id }}
                        search={paymentSearch}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-lime-gradient py-3.5 font-bold text-primary-foreground glow-lime transition-colors"
                      >
                        <Wallet className="h-4 w-4" /> {paymentCtaLabel}
                      </Link>
                      {/* Approved but not paid yet: a way out without opening the pay page. */}
                      <div className="mt-1.5 text-center">
                        <LeaveFlowButton gameId={game.id} gameTitle={game.title} variant="link" />
                      </div>
                    </motion.div>
                  );
                }
                return (
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      if (consentBlocksNewJoin) {
                        toast.error(
                          participationDecision.reason ||
                            "A parent or guardian must approve this account first.",
                        );
                        return;
                      }
                      if (waitlistCta) {
                        document
                          .getElementById("waitlist")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                        return;
                      }
                      const wantsLeave = isConfirmed || (joined && !isPaid);
                      const wantsFreeJoin =
                        !isConfirmed &&
                        !joined &&
                        !isPending &&
                        spotsLeft > 0 &&
                        !(requiresApproval && !isApproved) &&
                        !isPaid;
                      if (wantsLeave) {
                        setConfirmAction("leave");
                        return;
                      }
                      if (wantsFreeJoin) {
                        setConfirmAction("join");
                        return;
                      }
                      void handleJoin();
                    }}
                    disabled={buttonDisabled}
                    aria-live="polite"
                    aria-disabled={buttonDisabled}
                    className={`flex-1 rounded-2xl py-3.5 font-bold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                      isConfirmed
                        ? "bg-lime/15 border border-lime/40 text-lime"
                        : isPending
                          ? "bg-surface border border-coral/40 text-coral"
                          : joined
                            ? "bg-surface border border-lime/40 text-lime"
                            : lockedForNewJoin || spotsLeft <= 0 || consentBlocksNewJoin
                              ? "bg-surface border border-border text-muted-foreground"
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
                    ) : consentBlocksNewJoin ? (
                      <>
                        <Lock className="h-4 w-4" /> Parent approval needed
                      </>
                    ) : lockedForNewJoin ? (
                      <>
                        <Lock className="h-4 w-4" />{" "}
                        {gate.joinState === "in_progress"
                          ? "In progress"
                          : gate.joinState === "completed"
                            ? "Game ended"
                            : "Signup closed"}
                      </>
                    ) : spotsLeft <= 0 ? (
                      <>
                        <span
                          className="inline-block h-2 w-2 rounded-full bg-coral animate-pulse"
                          aria-hidden
                        />
                        Join Waitlist
                      </>
                    ) : requiresApproval && !isApproved ? (
                      <>
                        Request Spot · <LiveSpots />
                      </>
                    ) : isPaid ? (
                      <>
                        <Wallet className="h-4 w-4" /> Pay Host · ${fee.toFixed(2)}
                      </>
                    ) : (
                      <>
                        Join Run · <LiveSpots />
                      </>
                    )}
                  </motion.button>
                );
              })()}
          </div>
        </div>
      </div>

      {isHost && editOpen && (
        <EditGameModal
          // The editor seeds its fields from `settings` on mount; remount once
          // they finish loading so a slow fetch can't leave the host's saved
          // refund terms blank (and then overwrite them on save).
          key={settings ? "settings-loaded" : "settings-pending"}
          game={game}
          hostId={settings?.host_id ?? game.hostUserId ?? user?.id ?? ""}
          settings={settings}
          onClose={() => setEditOpen(false)}
          onSettingsSaved={(s) => setSettings(s)}
        />
      )}

      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "leave"
                ? "Leave this game?"
                : requiresApproval && !isApproved
                  ? "Request a spot?"
                  : "Join this run?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "leave"
                ? "Your spot will open up for someone else. You can rejoin if there's still space."
                : `You'll be added to the roster. ${cancelPolicyNote(game.cancelCutoffMin)}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmAction === "leave" && isLateCancel(game.date, game.cancelCutoffMin) && (
            <p
              role="alert"
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs font-medium text-amber-500"
            >
              {lateCancelWarning(game.cancelCutoffMin)}
            </p>
          )}
          {confirmAction === "join" && (
            <GameReminderPicker value={reminderOffsets} onChange={setReminderOffsets} />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={processing}
              onClick={(e) => {
                e.preventDefault();
                const action = confirmAction;
                setConfirmAction(null);
                if (action) void handleJoin();
              }}
              className={
                confirmAction === "leave"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
            >
              {confirmAction === "leave"
                ? isLateCancel(game.date, game.cancelCutoffMin)
                  ? "Leave anyway"
                  : "Leave game"
                : requiresApproval && !isApproved
                  ? "Request Spot"
                  : "Join Run"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !removingId) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removeTarget?.name ?? "player"} from this game?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They'll be notified and their spot will open up. They can request to join again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!removingId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!removingId}
              onClick={(e) => {
                e.preventDefault();
                if (removeTarget) {
                  void handleRemoveParticipant(removeTarget.userId, removeTarget.name);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove player
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
