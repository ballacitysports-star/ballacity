import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { pageHead, ogImageUrl } from "@/lib/seo";
import { motion, AnimatePresence } from "framer-motion";
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
  X as XIcon,
  Pencil,
  Play,
  Lock,
  Unlock,
  Trash2,
  ImagePlus,
  DollarSign,
  Home,
  ShieldCheck,
  History,
} from "lucide-react";
import { GAMES, SPORTS, imageFor } from "@/lib/sample-data";
import {
  ageGateMessage,
  ageGateState,
  ageRequirementLabel,
  hasAgeRequirement,
} from "@/lib/game-age";
import { useMyAge, fetchProfileAges } from "@/lib/use-my-age";
import { requesterAgeLabel } from "@/lib/game-age";
import { AgeRequirementFields } from "@/components/games/AgeRequirementFields";
import { formatGameEnds, formatGameWhen, formatWhen, formatWhenDate } from "@/lib/format";
import { gameEndsAt } from "@/lib/game-time";
import { AddToCalendarButton } from "@/components/datetime/AddToCalendarButton";
import { GameReminderCard, GameReminderPicker } from "@/components/GameReminderSettings";
import {
  DEFAULT_GAME_REMINDER_OFFSETS,
  saveMyGameReminderOffsets,
} from "@/lib/game-reminders";
import { ReviewsSection } from "@/components/ReviewsSection";
import { SpotsPill } from "@/components/SpotsPill";
import { UserAvatar } from "@/components/UserAvatar";
import { computeReputation, useReviewsFor } from "@/lib/reviews";
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
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
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
  reviewJoinRequest,
  upsertGamePaymentSettings,
  listMyPaymentMethods,
  paymentTypeMeta,
  getSignedProofUrl,
  joinResubmitCooldownRemainingMs,
  joinResubmitCapReached,
  JOIN_RESUBMIT_MAX_ATTEMPTS,
  type PaymentMethod,
  type GamePaymentSettings,
  type PaymentSubmission,
  type JoinRequest,
} from "@/lib/payments";
import { reviewPaymentAction } from "@/lib/payments.functions";
import { shouldTriggerLeaveBranch } from "@/lib/leave-branch";
import { useMyFlowStatus } from "@/lib/game-flow-status";
import { PlayerFlowPill } from "@/components/PlayerFlowPill";
import { PaymentRequiredBanner } from "@/components/PaymentRequiredBanner";
import { HostPaymentsPanel, PlayerPaymentsPanel } from "@/components/GamePaymentsPanel";
import { PostEngagement } from "@/components/PostEngagement";
import { GameDistance } from "@/components/GameDistance";
import { geocodeAddress } from "@/lib/geocode.functions";
import { SeriesSessionsStrip } from "@/components/SeriesSessionsStrip";

import {
  useHostedGames,
  fetchHostedGame,
  updateHostedGame,
  deleteHostedGame,
} from "@/lib/hosted-games-store";
import {
  ANY_SKILL,
  filterTiersForSport,
  formatSkillValue,
  parseSkillTiers,
  scaleForSport,
  serializeSkillTiers,
  toggleSkillTier,
} from "@/lib/sport-levels";
import type { Game } from "@/lib/sample-data";
import { PositionsPicker, positionsCleanup } from "@/components/PositionsPicker";
import { listMyTeams } from "@/lib/teams.functions";
import { listMyOrgs } from "@/lib/trainer-orgs.functions";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  computeLiveStatus,
  useJoinGate,
  SIGNUP_CUTOFF_PRESETS,
  cutoffAmountLabel,
} from "@/lib/live-status";
import type { JoinGate } from "@/lib/live-status";
import { JoinBlockedReason } from "@/components/JoinBlockedReason";

import { useAuth } from "@/hooks/use-auth";
import { useMyProfile } from "@/lib/user-prefs-store";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { createNotification } from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { useCanReview } from "@/lib/transactions";
import { blockUser, unblockUser, isUserBlocked, useBlockedUsers } from "@/lib/blocked-users-store";
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

const emojiBySport: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.name, s.emoji]),
);

const hostIdFor = (username: string) => `host-${username.replace(/^@/, "").toLowerCase()}`;

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

  loader: ({ params }) => {
    return { gameId: params.gameId };
  },
  head: ({ loaderData, params }) => {
    const game = loaderData ? GAMES.find((g) => g.id === loaderData.gameId) : undefined;
    const name = game?.title ?? "Pickup game";
    return pageHead({
      path: `/games/${params.gameId}`,
      title: `${name} — OpenRun`,
      description: (
        game?.description ?? "See the details for this pickup game and request to join on OpenRun."
      ).slice(0, 155),
      ogType: "article",
      image: ogImageUrl({
        kind: "game",
        title: name,
        subtitle: game ? [game.sport, game.neighborhood ?? game.location].filter(Boolean).join(" • ") : "Pickup game on OpenRun",
        meta: game ? [formatGameWhen(game), game.location, game.price ? `$${game.price}` : "Free"] : [],
      }),
      jsonLd: game
        ? {
            "@context": "https://schema.org",
            "@type": "SportsEvent",
            name: game.title,
            startDate: game.date,
            location: { "@type": "Place", name: game.location, address: game.neighborhood },
            sport: game.sport,
            url: `https://open-run-connect.lovable.app/games/${params.gameId}`,
          }
        : undefined,
    });
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

function formatCooldownLabel(ms: number): string {
  const secs = Math.max(1, Math.ceil(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function GameDetail() {
  const { gameId } = Route.useLoaderData();
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
  const myProfile = useMyProfile(user);
  const [settings, setSettings] = useState<GamePaymentSettings | null>(null);
  const [mySubs, setMySubs] = useState<PaymentSubmission[]>([]);
  const [myReq, setMyReq] = useState<JoinRequest | null>(null);
  const [hostRequests, setHostRequests] = useState<JoinRequest[]>([]);
  const [messaging, setMessaging] = useState(false);
  const [editOpen, _setEditOpen] = useState(urlModal === "edit");
  const [requesting, setRequesting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [positionRosterOpen, _setPositionRosterOpen] = useState(urlModal === "positions");
  const [reviewsOpen, _setReviewsOpen] = useState(urlModal === "reviews");
  const [activeTab, _setActiveTab] = useState<"overview" | "payments">(urlTab ?? "overview");
  const { status: myFlowStatus, settings: flowSettings } = useMyFlowStatus(gameId);

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

  const hostReviews = useReviewsFor(hostIdFor(game?.host.username ?? ""));
  const hostRep = useMemo(() => computeReputation(hostReviews, "host"), [hostReviews]);
  const canReviewHost = useCanReview(hostIdFor(game?.host.username ?? ""));

  // Guards refreshStatus while a leave flow is tearing down local + server
  // state. Realtime DELETE events for join_requests / payment_submissions
  // fire during the teardown and would otherwise refetch the (still-
  // committing) rows and re-hydrate the "Payment verified" strip.
  const leavingRef = useRef(false);

  const refreshStatus = async () => {
    if (!game) return;
    if (leavingRef.current) return;
    try {
      const [s, subs, req] = await Promise.all([
        getGamePaymentSettings(game.id),
        listMySubmissionsForGame(game.id),
        getMyJoinRequest(game.id),
      ]);
      if (leavingRef.current) return;
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

  useEffect(() => {
    if (GAMES.some((g) => g.id === gameId) || hosted.some((g) => g.id === gameId)) {
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
  }, [gameId]);

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

  if (!game && !lookupComplete) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

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

  const { age: myAge } = useMyAge();
  const fee = Number(settings?.entry_fee ?? game.price);
  const isPaid = fee > 0;
  // Host approval is the default. A game whose host hasn't saved settings yet
  // is treated as request-to-join; hosts can opt out in game settings.
  const hostRequiresApproval = settings ? !!settings.requires_approval : true;
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
  // Prefer the live participant count from `game_participants` (updates in
  // real time when anyone joins/leaves on any device) and fall back to the
  // cached `game.joined` counter until hydration completes. When we already
  // have the live count, the viewer is already reflected in it — don't
  // double-count them.
  const baseJoined = liveParticipantCount ?? game.joined ?? 0;
  const viewerDelta = viewerCountsAsJoined && liveParticipantCount === undefined ? 1 : 0;
  const effectiveJoined = baseJoined + viewerDelta;
  const spotsLeft = Math.max(0, game.maxPlayers - effectiveJoined);
  const gate = useJoinGate(game);
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

  const [confirmAction, setConfirmAction] = useState<"join" | "leave" | null>(null);
  // Reminder lead times the player picks while RSVPing.
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([
    ...DEFAULT_GAME_REMINDER_OFFSETS,
  ]);


  const executeJoinAction = async (preselectedPosition?: string) => {
    // Expired invite → block all join actions and steer to discovery.
    if (inviteExpired && !isHost && !viewerCountsAsJoined && !viewerPending) {
      toast.error("This invite has expired. Browse open games instead.");
      nav({ to: "/discover" });
      return;
    }
    // Host has blocked this user from their games.
    const gameHostId = settings?.host_id ?? game.hostUserId ?? null;
    if (
      !isHost &&
      user &&
      gameHostId &&
      !isConfirmed &&
      !joined &&
      !isPending &&
      isUserBlocked(gameHostId, user.id)
    ) {
      toast.error("The host has blocked you from joining their games.");
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
        toast("You left the game.");
        // Notify host in real time that a player left.
        if (gameHostId && user && gameHostId !== user.id) {
          const who = myProfile?.name || user.email?.split("@")[0] || "A player";
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
        if (wasJoined) joinGame(game.id);
        toast.error(e.message ?? "Could not leave.");
      } finally {
        leavingRef.current = false;
        // Single reconcile pass now that all deletes have committed.
        void refreshStatus();
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
        toast.success(
          isResubmit
            ? "Request resubmitted. The host will review it."
            : "Request sent. The host will review it.",
        );
      } catch (e: any) {
        setMyReq(prevReq);
        toast.error(e.message ?? "Could not send request.");
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
    joinGame(game.id, preselectedPosition);
    void saveMyGameReminderOffsets(game.id, reminderOffsets).catch(() => {});
    toast.success(`You're in! See you at ${game.location}.`);
    // Notify host in real time that a new player joined.
    if (gameHostId && user && gameHostId !== user.id) {
      const who = myProfile?.name || user.email?.split("@")[0] || "A player";
      void createNotification({
        user_id: gameHostId,
        type: "participant_joined",
        title: `${who} joined ${game.title}`,
        body: `${effectiveJoined + 1}/${game.maxPlayers} players confirmed.`,
        link: `/games/${game.id}`,
      }).catch(() => {});
    }
  };

  const handleJoin = async (preselectedPosition?: string) => {

    setProcessing(true);
    try {
      await executeJoinAction(preselectedPosition);
    } finally {
      setProcessing(false);
    }
  };

  const viewerPending =
    !isHost && requiresApproval && myReq?.status === "pending" && !viewerCountsAsJoined;
  const hostPendingReqs = isHost ? hostRequests.filter((r) => r.status === "pending") : [];
  const pendingCount = hostPendingReqs.length;
  type RosterEntry =
    | {
        kind: "player";
        initials: string;
        isMe: boolean;
        pending: false;
        userId?: string;
        displayName?: string;
        avatarUrl?: string | null;
      }
    | { kind: "viewerPending"; initials: "YOU"; isMe: true; pending: true }
    | { kind: "hostPending"; req: JoinRequest; pending: true };

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
          <h1 className="font-display text-3xl font-bold drop-shadow-lg">{game.title}</h1>
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
                <span className="inline-flex items-center justify-center rounded-full bg-coral px-1.5 text-[10px] font-bold text-white min-w-[18px] h-[18px]">
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
                  {requiresApproval ? "“Request to join”" : isPaid ? "“Pay & join”" : "“Join”"}{" "}
                  below to confirm your spot.
                </p>
              </div>
            </div>
          ))}

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

        {/* Approval status banner (player view).
            Driven by the shared useMyFlowStatus so paid games always show
            "Payment due" (or the matching payment stage) until the host
            verifies the payment — never "You're approved / on the roster". */}
        {!isHost &&
          requiresApproval &&
          myReq &&
          (() => {
            // Paid games: pick copy from the shared flow status so this banner
            // can't disagree with the pill / PaymentRequiredBanner / pay page.
            if (isPaid) {
              const paidCopy: Record<
                string,
                { title: string; body: string; tone: "warn" | "info" | "ok" | "bad" | "muted" }
              > = {
                requested: {
                  title: "Waiting for host approval",
                  body: "Your spot isn't held until the host approves. You'll get a notification when they respond.",
                  tone: "warn",
                },
                payment_pending: {
                  title: "Payment due",
                  body: "Submit payment to lock your spot on the roster.",
                  tone: "warn",
                },
                payment_submitted: {
                  title: "Payment sent — waiting on host to confirm",
                  body: "The host is reviewing your proof. You'll be confirmed once they verify.",
                  tone: "info",
                },
                payment_rejected: {
                  title: "Payment declined — resubmit to keep your spot",
                  body:
                    myReq.reviewer_notes ||
                    "The host couldn't verify your last payment. Send new proof to lock your spot.",
                  tone: "bad",
                },
                payment_verified: {
                  title: "Payment confirmed — you're on the roster",
                  body: "You're all set. See you at the game!",
                  tone: "ok",
                },
                confirmed: {
                  title: "Payment confirmed — you're on the roster",
                  body: "You're all set. See you at the game!",
                  tone: "ok",
                },
                rejected: {
                  title: "Request declined",
                  body: capReached
                    ? `${myReq.reviewer_notes ? `${myReq.reviewer_notes} · ` : ""}You've reached the ${JOIN_RESUBMIT_MAX_ATTEMPTS}-attempt limit for this game. Message the host instead.`
                    : cooldownMs > 0
                      ? `${myReq.reviewer_notes ? `${myReq.reviewer_notes} · ` : ""}You can resubmit in ${formatCooldownLabel(cooldownMs)}.`
                      : `${myReq.reviewer_notes ? `${myReq.reviewer_notes} · ` : ""}You can send another request or message the host.`,
                  tone: "muted",
                },
              };
              const entry = paidCopy[myFlowStatus];
              if (!entry) return null;
              const toneClass =
                entry.tone === "warn"
                  ? "border-coral/40 bg-coral/10"
                  : entry.tone === "bad"
                    ? "border-destructive/50 bg-destructive/10"
                    : entry.tone === "ok"
                      ? "border-lime/40 bg-lime/10"
                      : entry.tone === "info"
                        ? "border-lime/40 bg-lime/5"
                        : "border-border bg-surface";
              const Icon =
                entry.tone === "warn" || entry.tone === "info"
                  ? Clock
                  : entry.tone === "ok"
                    ? Check
                    : entry.tone === "bad"
                      ? XIcon
                      : XIcon;
              const iconColor =
                entry.tone === "warn"
                  ? "text-coral"
                  : entry.tone === "ok"
                    ? "text-lime"
                    : entry.tone === "bad"
                      ? "text-destructive"
                      : entry.tone === "info"
                        ? "text-lime"
                        : "text-muted-foreground";
              return (
                <div
                  className={`rounded-2xl border p-4 flex items-start gap-3 ${toneClass}`}
                  role="status"
                  aria-live="polite"
                >
                  <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${iconColor}`} />
                  <div className="min-w-0">
                    <div className="font-display text-sm font-bold">{entry.title}</div>
                    <p className="text-xs text-muted-foreground mt-0.5">{entry.body}</p>
                  </div>
                </div>
              );
            }

            // Free games: original approval-only copy (no payment stage exists).
            return (
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
                        : capReached
                          ? `${myReq.reviewer_notes ? `${myReq.reviewer_notes} · ` : ""}You've reached the ${JOIN_RESUBMIT_MAX_ATTEMPTS}-attempt limit for this game. Message the host instead.`
                          : cooldownMs > 0
                            ? `${myReq.reviewer_notes ? `${myReq.reviewer_notes} · ` : ""}You can resubmit in ${formatCooldownLabel(cooldownMs)}.`
                            : `${myReq.reviewer_notes ? `${myReq.reviewer_notes} · ` : ""}You can send another request or message the host.`}
                  </p>
                </div>
              </div>
            );
          })()}

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
                text: "Payment due — submit payment to lock your spot",
                tone: "warn",
              },
              payment_submitted: {
                text: "Payment sent — waiting on host to confirm",
                tone: "info",
              },
              payment_rejected: { text: "Payment declined — resubmit below", tone: "bad" },
              payment_verified: { text: "Payment verified — you're on the roster", tone: "ok" },
              confirmed: { text: "Payment verified — you're on the roster", tone: "ok" },
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
            const NameTag: any = hostId ? Link : "span";
            const nameProps = hostId
              ? {
                  to: "/players/$userId",
                  params: { userId: hostId },
                  className: "hover:text-lime hover:underline",
                }
              : {};
            const avatarEl = (
              <UserAvatar
                avatarUrl={(game as { hostAvatarUrl?: string | null }).hostAvatarUrl ?? null}
                initials={game.host.avatar}
                name={game.host.name}
                size="lg"
                rounded="square"
              />
            );
            return (
              <>
                {hostId ? (
                  <Link
                    to="/players/$userId"
                    params={{ userId: hostId }}
                    aria-label={`View ${game.host.name}'s profile`}
                  >
                    {avatarEl}
                  </Link>
                ) : (
                  avatarEl
                )}
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

        {/* Host reputation (opens reviews popup) */}
        {hostRep.count > 0 && (
          <div className="mt-3">
            <ReputationBadge
              rep={hostRep}
              onClick={() => setReviewsOpen(true)}
              ariaLabel={`Open host reviews for ${game.host.name}. Trust score ${hostRep.trustScore}, ${hostRep.avg.toFixed(1)} out of 5 from ${hostRep.count} review${hostRep.count === 1 ? "" : "s"}.`}
            />
          </div>
        )}

        {/* Host reviews popup */}
        <Dialog open={reviewsOpen} onOpenChange={setReviewsOpen}>
          <DialogContent
            className="max-h-[90dvh] w-[min(100%,40rem)] overflow-y-auto p-0"
            aria-labelledby="host-reviews-title"
            aria-describedby="host-reviews-desc"
          >
            <DialogHeader className="sr-only">
              <DialogTitle id="host-reviews-title">Reviews for host {game.host.name}</DialogTitle>
              <DialogDescription id="host-reviews-desc">
                Browse, filter, and sort reviews left for this host. Press Escape to close.
              </DialogDescription>
            </DialogHeader>
            <div className="p-4">
              <ReviewsSection
                revieweeId={hostIdFor(game.host.username)}
                revieweeKind="host"
                revieweeName={game.host.name}
                isOwner={ownsViaGame}
              />
            </div>
          </DialogContent>
        </Dialog>

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

        {/* Discussion */}
        <div>
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Discussion
          </h2>
          <PostEngagement subjectType="game" subjectId={game.id} />
        </div>

        {/* Payment settings summary */}
        {(settings?.payment_deadline ||
          settings?.refund_policy ||
          settings?.payment_instructions) && (
          <div className="rounded-3xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2 mb-3">
              <CreditCard className="h-4 w-4 text-lime" />
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Payment settings
              </h2>
            </div>
            <div className="space-y-3">
              {settings?.payment_deadline && (
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Payment deadline</div>
                  <div className="text-sm font-semibold">
                    {new Date(settings.payment_deadline).toLocaleString()}
                  </div>
                </div>
              )}
              {settings?.refund_policy && (
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Refund policy</div>
                  <p className="text-sm leading-relaxed">{settings.refund_policy}</p>
                </div>
              )}
              {settings?.payment_instructions && (
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Payment instructions</div>
                  <p className="text-sm leading-relaxed">{settings.payment_instructions}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Positions needed */}
        {game.positionsNeeded && Object.keys(game.positionsNeeded).length > 0 && (
          <div id="waitlist" className="scroll-mt-24">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Positions needed
              </h2>
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
                                myProfile?.name || user.email?.split("@")[0] || "A player";
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

        {/* Players */}
        <div>
          <div className="flex items-center justify-between mb-2 gap-2">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2 flex-wrap">
              <span>
                Roster (
                <span
                  key={effectiveJoined}
                  className="inline-block motion-safe:animate-scale-in tabular-nums"
                >
                  {effectiveJoined}
                </span>
                /{game.maxPlayers})
              </span>
              <SpotsPill spotsLeft={spotsLeft} maxPlayers={game.maxPlayers} />
              {(viewerPending || pendingCount > 0) && (
                <span className="inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/10 px-2 py-0.5 text-[10px] font-bold text-coral normal-case tracking-normal">
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
                    onOptimistic={applyOptimisticReview}
                    index={i}
                  />
                );
              }
              const isRealPlayer = p.kind === "player" && !!p.userId && !p.isMe && !!p.displayName;
              const chip = (
                <motion.div
                  key={i}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: i * 0.04 }}
                  title={
                    p.pending
                      ? "Pending host approval"
                      : p.kind === "player" && p.displayName
                        ? p.displayName
                        : undefined
                  }
                  className={`relative grid h-11 w-11 place-items-center overflow-hidden rounded-full border text-xs font-bold ${
                    p.pending
                      ? "border-dashed border-coral/60 bg-coral/10 text-coral"
                      : p.isMe
                        ? "border-lime bg-lime/15 text-lime"
                        : "border-border bg-surface"
                  }`}
                >
                  {p.kind === "player" && p.avatarUrl ? (
                    <img
                      src={p.avatarUrl}
                      alt={p.displayName ?? p.initials}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    p.initials
                  )}
                  {p.pending && (
                    <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-coral text-[8px] text-white">
                      <Clock className="h-2.5 w-2.5" />
                    </span>
                  )}
                </motion.div>
              );
              if (isRealPlayer && p.kind === "player" && p.userId) {
                return (
                  <Link
                    key={i}
                    to="/players/$userId"
                    params={{ userId: p.userId }}
                    className="focus:outline-none focus-visible:ring-2 focus-visible:ring-lime rounded-full"
                  >
                    {chip}
                  </Link>
                );
              }
              return chip;
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
        <div
          className={`page-shell mt-4 space-y-3 ${isPaid && activeTab !== "overview" ? "hidden" : ""}`}
        >
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
                className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
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
                  void updateHostedGame(game.id, { signupCutoffMin: v } as never).catch(() => {});
                  toast.success(
                    v > 0
                      ? `Signups will close ${cutoffAmountLabel(v)} before start.`
                      : "Signup cutoff turned off.",
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
                    void updateHostedGame(game.id, { status: "completed" }).catch(() => {});
                    toast.success("Game marked as ended.");
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
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm("Delete this game? This can't be undone.")) return;
                try {
                  await deleteHostedGame(game.id);
                  toast.success("Game deleted.");
                  nav({ to: "/" });
                } catch {
                  toast.error("Couldn't delete this game.");
                }
              }}
              className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-coral/40 bg-coral/10 text-coral py-2.5 text-xs font-bold"
            >
              <Trash2 className="h-4 w-4" /> Delete game
            </button>
          </div>

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
                    ageReq={ageReq}
                    gameTitle={game.title}
                    onOptimistic={applyOptimisticReview}
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
                  <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    Roster · {totalConfirmed} / {game.maxPlayers}
                  </h2>
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
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Sticky CTA */}
      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+6rem)] left-0 right-0 z-30 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur-xl bg-background/80 border-t border-border">
        <div className="mx-auto w-[min(100%,28rem)]">
          {!isHost && !joined && !isPending && !isConfirmed && !isApproved && (
            <JoinBlockedReason gate={viewerGate} className="mb-2" waitlistHint />
          )}
          {ageNotice && !isConfirmed && !isApproved && (
            <p className="mb-2 text-[11px] font-medium text-muted-foreground" role="status">
              🎂 {ageNotice}
            </p>
          )}
          <div className="flex items-center gap-2">
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
            {!isHost &&
              (() => {
                // Locked games (started / host-closed / inside the blackout window)
                // block NEW joins, but keep leave/cancel and payment actions live.
                const lockedForNewJoin =
                  gate.locked && !joined && !isPending && !isConfirmed && !isApproved;
                const canJoinAction = joined || isPending || isConfirmed || spotsLeft > 0;
                const buttonDisabled =
                  requesting || processing || !canJoinAction || lockedForNewJoin;
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
                      : `Pay host · $${fee.toFixed(2)}`;
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
                if (paymentAction) {
                  return (
                    <motion.div whileTap={{ scale: 0.97 }} className="flex-1">
                      <Link
                        to="/games/$gameId/pay"
                        params={{ gameId: game.id }}
                        search={paymentSearch}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-lime-gradient py-3.5 font-bold text-primary-foreground glow-lime transition-colors"
                      >
                        <CreditCard className="h-4 w-4" /> {paymentCtaLabel}
                      </Link>
                    </motion.div>
                  );
                }
                return (
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
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
                            : lockedForNewJoin || spotsLeft <= 0
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
                        Full · Waiting for a spot
                      </>
                    ) : requiresApproval && !isApproved ? (
                      <>
                        Request to join · <LiveSpots />
                      </>
                    ) : isPaid ? (
                      <>
                        <CreditCard className="h-4 w-4" /> Pay host · ${fee.toFixed(2)}
                      </>
                    ) : (
                      <>
                        Join free · <LiveSpots />
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
              {confirmAction === "leave" ? "Leave this game?" : "Join this game?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "leave"
                ? "Your spot will open up for someone else. You can rejoin if there's still space."
                : "You'll be added to the roster. You can leave later if plans change."}
            </AlertDialogDescription>
          </AlertDialogHeader>
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
              {confirmAction === "leave" ? "Leave game" : "Join game"}
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

function EditGameModal({
  game,
  hostId,
  settings,
  onClose,
  onSettingsSaved,
}: {
  game: Game;
  hostId: string;
  settings: GamePaymentSettings | null;
  onClose: () => void;
  onSettingsSaved: (s: GamePaymentSettings) => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState(game.title);
  const [sport, setSport] = useState<Game["sport"]>(game.sport);
  const [skill, setSkill] = useState<Game["skill"]>(game.skill);
  // Tier list follows the game's sport, matching the profile scale.
  const skillOptions = [ANY_SKILL, ...filterTiersForSport(sport)];
  const selectedSkillTiers = parseSkillTiers(sport, skill);
  const skillMulti = scaleForSport(sport).multi ?? false;
  useEffect(() => {
    if (skill === ANY_SKILL) return;
    const kept = serializeSkillTiers(sport, parseSkillTiers(sport, skill));
    if (kept !== skill) setSkill(kept);
  }, [sport, skill]);
  const [location, setLocation] = useState(game.location);
  const [neighborhood, setNeighborhood] = useState(game.neighborhood ?? "");
  const [dateLocal, setDateLocal] = useState(() => {
    const d = new Date(game.date);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [duration] = useState(game.duration);
  const [allDay, setAllDay] = useState(!!game.allDay);
  const [endLocal, setEndLocal] = useState(() => toLocalInput(gameEndsAt(game)));
  const [maxPlayers, setMaxPlayers] = useState<number>(
    Math.max(2, Math.min(30, Number(game.maxPlayers) || 10)),
  );
  const [price, setPrice] = useState<number>(Math.max(0, Number(game.price) || 0));
  const [indoor, setIndoor] = useState(!!game.indoor);
  const [isPrivate, setIsPrivate] = useState(!!game.isPrivate);
  const [image, setImage] = useState(game.image ?? "");
  const [description, setDescription] = useState(game.description);
  const [positionsNeeded, setPositionsNeeded] = useState<Record<string, number>>(
    game.positionsNeeded ?? {},
  );
  const [requiresApproval, setRequiresApproval] = useState<boolean>(
    settings ? !!settings.requires_approval : true,
  );
  const [minAge, setMinAge] = useState<number | null>(game.minAge ?? null);
  const [maxAge, setMaxAge] = useState<number | null>(game.maxAge ?? null);
  const [acceptedMethodIds, setAcceptedMethodIds] = useState<Set<string>>(
    () => new Set(settings?.accepted_method_ids ?? []),
  );
  const [paymentDeadline, setPaymentDeadline] = useState<string>(
    settings?.payment_deadline ? settings.payment_deadline.slice(0, 16) : "",
  );
  const [refundPolicy, setRefundPolicy] = useState<string>(settings?.refund_policy ?? "");
  const [paymentInstructions, setPaymentInstructions] = useState<string>(
    settings?.payment_instructions ?? "",
  );
  const [myMethods, setMyMethods] = useState<PaymentMethod[]>([]);
  const [coverUploading, setCoverUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Host-as (team/gym) — only editable before the game starts.
  const hasStarted = computeLiveStatus(game) !== "scheduled";
  const geocode = useServerFn(geocodeAddress);
  const fetchMyTeams = useServerFn(listMyTeams);
  const fetchMyOrgs = useServerFn(listMyOrgs);
  const myTeamsQuery = useQuery({
    queryKey: ["my-teams", user?.id ?? "anon"],
    queryFn: () => fetchMyTeams(),
    enabled: !!user && !hasStarted,
    staleTime: 30_000,
  });
  const myOrgsQuery = useQuery({
    queryKey: ["my-orgs", user?.id ?? "anon"],
    queryFn: () => fetchMyOrgs(),
    enabled: !!user && !hasStarted,
    staleTime: 30_000,
  });
  type EditAffiliation = {
    source: "team" | "org";
    id: string;
    name: string;
    kind?: "team" | "coach";
  };
  const editAffiliations: EditAffiliation[] = [
    ...(myTeamsQuery.data ?? []).map((t) => ({
      source: "team" as const,
      id: t.id,
      name: t.name,
      kind: t.kind,
    })),
    ...(myOrgsQuery.data ?? []).map((o) => ({ source: "org" as const, id: o.id, name: o.name })),
  ];
  const affLabel = (a: EditAffiliation) =>
    a.source === "org" ? "Gym" : a.kind === "coach" ? "Trainer" : "Team";
  const initialAff: EditAffiliation | null = game.teamId
    ? { source: "team", id: game.teamId, name: "", kind: "team" }
    : game.orgId
      ? { source: "org", id: game.orgId, name: "" }
      : null;
  const [selectedAff, setSelectedAff] = useState<EditAffiliation | null>(initialAff);
  useEffect(() => {
    if (!selectedAff) return;
    const match = editAffiliations.find(
      (a) => a.source === selectedAff.source && a.id === selectedAff.id,
    );
    if (match && match.name && !selectedAff.name) setSelectedAff(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editAffiliations.length]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const m = await listMyPaymentMethods();
        if (!cancel) setMyMethods(m.filter((x) => x.is_enabled));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const mp = Math.max(2, Math.min(30, Number(maxPlayers) || game.maxPlayers));
      const pr = Math.max(0, Number(price) || 0);
      const iso = new Date(dateLocal).toISOString();
      const startMs = new Date(dateLocal).getTime();
      const endMs = new Date(endLocal).getTime();
      if (!allDay && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
        toast.error("End time must be after the start time.");
        return;
      }
      const nextDurationMin =
        !allDay && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
          ? Math.round((endMs - startMs) / 60000)
          : null;
      // Re-resolve venue coordinates whenever the host edits the address so
      // viewer-relative distance stays accurate.
      const nextLocation = location.trim() || game.location;
      let venue: { lat: number; lng: number } | null = null;
      let venueChanged = false;
      if (nextLocation !== game.location) {
        venueChanged = true;
        try {
          const res = await geocode({ data: { address: nextLocation } });
          venue = { lat: res.lat, lng: res.lng };
        } catch {
          venue = null;
        }
      }
      const trimmedImage = image.trim();
      const finalImage = trimmedImage || imageFor(sport);
      const updated = await updateHostedGame(game.id, {
        title: title.trim() || game.title,
        sport,
        skill,
        minAge,
        maxAge,
        location: nextLocation,
        neighborhood: neighborhood.trim(),
        ...(venueChanged ? { lat: venue?.lat ?? null, lng: venue?.lng ?? null } : {}),
        date: Number.isFinite(new Date(dateLocal).getTime()) ? iso : game.date,
        duration: nextDurationMin ? `${nextDurationMin} min` : duration.trim() || game.duration,
        endsAt: allDay ? null : Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
        allDay,
        maxPlayers: mp,
        price: pr,
        indoor,
        isPrivate,
        image: finalImage,
        description,
        positionsNeeded: positionsCleanup(positionsNeeded),
        ...(hasStarted
          ? {}
          : {
              teamId: selectedAff?.source === "team" ? selectedAff.id : null,
              orgId: selectedAff?.source === "org" ? selectedAff.id : null,
            }),
      } as Partial<Game>).catch((err: any) => {
        toast.error(err?.message ?? "Couldn't save changes.");
        return undefined;
      });
      if (!updated) {
        return;
      }

      try {
        await upsertGamePaymentSettings({
          game_id: game.id,
          entry_fee: pr,
          accepted_method_ids: pr > 0 ? Array.from(acceptedMethodIds) : [],
          payment_deadline: paymentDeadline ? new Date(paymentDeadline).toISOString() : null,
          refund_policy: refundPolicy.trim() || null,
          payment_instructions: paymentInstructions.trim() || null,
          requires_approval: requiresApproval,
        });
        const next = await getGamePaymentSettings(game.id);
        if (next) onSettingsSaved(next);
      } catch (err: any) {
        toast.error(err?.message ?? "Saved game, but couldn't update host settings.");
      }

      // Notify confirmed players when the schedule end changed (end time or
      // all-day toggle) — their plans and calendar invites depend on it.
      const prevEndMs = gameEndsAt(game);
      const nextEndMs = allDay
        ? prevEndMs
        : Number.isFinite(endMs)
          ? endMs
          : prevEndMs;
      const endChanged = !allDay && nextEndMs !== prevEndMs;
      const allDayChanged = !!game.allDay !== allDay;
      if (endChanged || allDayChanged) {
        void (async () => {
          try {
            const { data: roster } = await supabase
              .from("game_participants")
              .select("user_id")
              .eq("game_id", game.id);
            const targets = (roster ?? [])
              .map((r: any) => String(r.user_id))
              .filter((uid) => uid && uid !== user?.id);
            const body = allDayChanged
              ? allDay
                ? `${title.trim() || game.title} is now an all-day event on ${formatWhenDate(game.date)}.`
                : `${title.trim() || game.title} now ends at ${formatEndsAt({
                    ...game,
                    allDay,
                    endsAt: new Date(nextEndMs).toISOString(),
                  } as Game)}.`
              : `New end time: ${formatEndsAt({
                  ...game,
                  allDay,
                  endsAt: new Date(nextEndMs).toISOString(),
                } as Game)}.`;
            await Promise.all(
              targets.map((uid) =>
                createNotification({
                  user_id: uid,
                  type: "game_time_changed",
                  title: `Schedule updated: ${title.trim() || game.title}`,
                  body,
                  link: `/games/${game.id}`,
                }).catch(() => {}),
              ),
            );
          } catch {
            /* best effort */
          }
        })();
      }

      toast.success("Game updated.");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[min(100%,40rem)] rounded-2xl border border-border bg-surface p-4 max-h-[85vh] overflow-y-auto">
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
        <div className="mt-3 space-y-4">
          {/* Host as (team/gym) — locked once the game starts */}
          <Field label={hasStarted ? "Host as (locked — game has started)" : "Host as"}>
            {hasStarted ? (
              <div className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                {game.teamId ? "Team" : game.orgId ? "Gym" : "Personal"} affiliation is locked after
                the game starts.
              </div>
            ) : editAffiliations.length === 0 ? (
              <div className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                No teams or gyms available.
              </div>
            ) : (
              <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
                {editAffiliations.map((a) => {
                  const active = selectedAff?.source === a.source && selectedAff.id === a.id;
                  return (
                    <button
                      type="button"
                      key={`${a.source}:${a.id}`}
                      onClick={() => setSelectedAff(a)}
                      className={`shrink-0 flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold ${
                        active
                          ? "border-lime bg-lime/10 text-lime"
                          : "border-border bg-background text-muted-foreground"
                      }`}
                    >
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-surface text-xs font-bold">
                        {(a.name || "?").slice(0, 1).toUpperCase()}
                      </span>
                      <span className="truncate max-w-[10rem]">{a.name || "Loading…"}</span>
                      <span className="text-[10px] uppercase tracking-wider opacity-70">
                        {affLabel(a)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          {/* Sport grid */}
          <Field label="Sport">
            <div className="grid grid-cols-3 gap-2">
              {SPORTS.map((s) => {
                const active = sport === s.name;
                return (
                  <button
                    type="button"
                    key={s.name}
                    onClick={() => {
                      setSport(s.name);
                      setPositionsNeeded({});
                    }}
                    className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-xs font-semibold transition-all ${
                      active
                        ? "border-lime bg-lime/10 text-lime"
                        : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    <span className="text-2xl">{s.emoji}</span>
                    <span>{s.name}</span>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Cover photo */}
          <Field label="Cover photo">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-background">
              <img
                src={image || imageFor(sport)}
                alt="Game cover preview"
                className="h-32 w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-2">
                <span className="text-[11px] text-white/90">
                  {image ? "Custom cover" : "Default cover"}
                </span>
                <div className="flex items-center gap-2">
                  {image && (
                    <button
                      type="button"
                      onClick={() => setImage("")}
                      className="grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white"
                      aria-label="Remove cover"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={coverUploading || !user}
                    onClick={() => coverInputRef.current?.click()}
                    className="rounded-full bg-lime px-3 py-1 text-[11px] font-bold text-primary-foreground disabled:opacity-60"
                  >
                    {coverUploading ? "Uploading…" : image ? "Replace" : "Upload"}
                  </button>
                </div>
              </div>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file || !user) return;
                  if (file.size > 5 * 1024 * 1024) {
                    toast.error("Image too large (max 5MB).");
                    return;
                  }
                  setCoverUploading(true);
                  try {
                    const ext = file.name.split(".").pop() || "jpg";
                    const path = `${user.id}/${Date.now()}-${Math.random()
                      .toString(36)
                      .slice(2, 8)}.${ext}`;
                    const { error: upErr } = await supabase.storage
                      .from("game-covers")
                      .upload(path, file, { cacheControl: "3600", upsert: false });
                    if (upErr) throw upErr;
                    const { data, error: urlErr } = await supabase.storage
                      .from("game-covers")
                      .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
                    if (urlErr || !data?.signedUrl) throw urlErr ?? new Error("Signed URL failed");
                    setImage(data.signedUrl);
                  } catch (err: any) {
                    toast.error(err?.message ?? "Upload failed");
                  } finally {
                    setCoverUploading(false);
                  }
                }}
              />
            </div>
            <input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="Or paste image URL…"
              className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs"
            />
          </Field>

          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Venue address">
            <LocationAutocomplete
              value={location}
              onChange={setLocation}
              placeholder="Search court, park or venue"
            />
          </Field>

          <Field label="Neighborhood">
            <input
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>

          {/* Skill chips */}
          <Field label={`Skill level · ${scaleForSport(sport).system}`}>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
              {skillOptions.map((s) => {
                const active =
                  s === ANY_SKILL
                    ? selectedSkillTiers.length === 0
                    : selectedSkillTiers.includes(s);
                return (
                  <button
                    type="button"
                    key={s}
                    aria-pressed={active}
                    onClick={() =>
                      setSkill(s === ANY_SKILL ? ANY_SKILL : toggleSkillTier(sport, skill, s))
                    }
                    className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold ${
                      active
                        ? "border-lime bg-lime text-primary-foreground"
                        : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            {skillMulti && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Pick a level in each football format — selections combine.
              </p>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date & time">
              <input
                type="datetime-local"
                value={dateLocal}
                onChange={(e) => setDateLocal(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm [color-scheme:dark]"
              />
            </Field>
            <Field label="Ends (date & time)">
              <input
                type="datetime-local"
                value={endLocal}
                min={dateLocal}
                disabled={allDay}
                onChange={(e) => setEndLocal(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm [color-scheme:dark] disabled:opacity-50"
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAllDay((v) => !v)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                allDay
                  ? "border-lime bg-lime/10 text-lime"
                  : "border-border bg-background text-muted-foreground"
              }`}
            >
              All-day event
            </button>
            {!allDay &&
              [60, 90, 120, 180].map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => {
                    const start = new Date(dateLocal).getTime();
                    if (Number.isFinite(start)) setEndLocal(toLocalInput(start + min * 60000));
                  }}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                >
                  {min < 120 ? `${min} min` : `${min / 60} h`}
                </button>
              ))}
          </div>

          {/* Max players slider */}
          <Field label="Max players">
            <div className="rounded-2xl border border-border bg-background p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Total spots</span>
                <span className="font-display text-xl font-bold text-lime">{maxPlayers}</span>
              </div>
              <input
                type="range"
                min={2}
                max={30}
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(+e.target.value)}
                className="w-full accent-lime"
              />
            </div>
          </Field>

          {/* Paid game toggle */}
          <Field label="Details">
            <div className="rounded-2xl border border-border bg-background px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm">
                  <DollarSign
                    className={`h-4 w-4 ${price > 0 ? "text-lime" : "text-muted-foreground"}`}
                  />
                  <span className="font-medium">Paid game</span>
                </span>
                <button
                  type="button"
                  onClick={() => setPrice(price > 0 ? 0 : 10)}
                  className={`relative h-6 w-10 rounded-full transition-colors ${price > 0 ? "bg-lime" : "bg-secondary"}`}
                  aria-label="Toggle paid game"
                >
                  <span
                    className="absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all"
                    style={{ left: price > 0 ? "calc(100% - 1.375rem)" : "0.125rem" }}
                  />
                </button>
              </div>
              {price > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Entry fee
                  </span>
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      $
                    </span>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full rounded-xl border border-border bg-surface pl-7 pr-3 py-1.5 text-sm outline-none focus:border-lime"
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground">per player</span>
                </div>
              )}
            </div>
            <EditToggle
              icon={<Home className="h-4 w-4" />}
              label="Indoor venue"
              value={indoor}
              onChange={setIndoor}
            />
            <EditToggle
              icon={<Lock className="h-4 w-4" />}
              label="Private (invite only)"
              value={isPrivate}
              onChange={setIsPrivate}
            />
            <EditToggle
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Require my approval to join"
              value={requiresApproval}
              onChange={setRequiresApproval}
            />
            {requiresApproval && (
              <p className="px-1 text-[11px] text-muted-foreground">
                Players send a pickup request and you approve or decline each one.
              </p>
            )}
            <AgeRequirementFields
              minAge={minAge}
              maxAge={maxAge}
              onChange={(n) => {
                setMinAge(n.minAge);
                setMaxAge(n.maxAge);
              }}
              idPrefix="edit-age"
            />
          </Field>

          {price > 0 && (
            <Field label="Accepted payment methods">
              {myMethods.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-coral/40 bg-coral/5 p-3 text-xs">
                  <div className="font-semibold text-coral">No payment methods yet</div>
                  <p className="mt-1 text-muted-foreground">
                    Add Venmo, Cash App, Zelle, or others in the Payments tab so players can pay.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {myMethods.map((m) => {
                    const meta = paymentTypeMeta(m.payment_type);
                    const on = acceptedMethodIds.has(m.id);
                    return (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => {
                          const n = new Set(acceptedMethodIds);
                          if (on) n.delete(m.id);
                          else n.add(m.id);
                          setAcceptedMethodIds(n);
                        }}
                        className={`flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left ${
                          on ? "border-lime bg-lime/5" : "border-border bg-background"
                        }`}
                      >
                        <div className="grid h-8 w-8 place-items-center rounded-xl bg-secondary text-base">
                          {meta.emoji}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">
                            {m.label || meta.name}
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {m.username || m.contact_info}
                          </div>
                        </div>
                        <div
                          className={`grid h-5 w-5 place-items-center rounded-full ${
                            on ? "bg-lime text-primary-foreground" : "border border-border"
                          }`}
                        >
                          {on && <Check className="h-3 w-3" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>
          )}

          {price > 0 && (
            <Field label="Payment deadline (optional)">
              <input
                type="datetime-local"
                value={paymentDeadline}
                onChange={(e) => setPaymentDeadline(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm [color-scheme:dark]"
              />
            </Field>
          )}

          {price > 0 && (
            <Field label="Refund policy (optional)">
              <textarea
                value={refundPolicy}
                onChange={(e) => setRefundPolicy(e.target.value)}
                rows={2}
                placeholder="e.g. Full refund up to 24h before tip-off."
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none"
              />
            </Field>
          )}

          {price > 0 && (
            <Field label="Payment instructions (optional)">
              <textarea
                value={paymentInstructions}
                onChange={(e) => setPaymentInstructions(e.target.value)}
                rows={2}
                placeholder="e.g. Include your full name in the payment note."
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none"
              />
            </Field>
          )}

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Positions needed">
            <PositionsPicker sport={sport} value={positionsNeeded} onChange={setPositionsNeeded} />
          </Field>
        </div>
        <BlockedUsersSection hostId={hostId} />
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-xl border border-border bg-background py-2.5 text-sm font-semibold disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-xl bg-lime-gradient py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditToggle({
  icon,
  label,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="mt-2 flex w-full items-center justify-between rounded-2xl border border-border bg-background px-3 py-2.5 text-sm"
    >
      <span className="flex items-center gap-2">
        <span className={value ? "text-lime" : "text-muted-foreground"}>{icon}</span>
        <span className="font-medium">{label}</span>
      </span>
      <span
        className={`relative h-6 w-10 rounded-full transition-colors ${value ? "bg-lime" : "bg-secondary"}`}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all"
          style={{ left: value ? "calc(100% - 1.375rem)" : "0.125rem" }}
        />
      </span>
    </button>
  );
}

/** ms -> value for a <input type="datetime-local"> in local time. */
function toLocalInput(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}

/** End date + time for the meta grid; falls back to the raw length text. */
function formatEndsAt(
  game: Pick<Game, "date" | "duration" | "allDay"> & { endsAt?: string | null },
): string {
  const end = gameEndsAt(game);
  return formatGameEnds({
    date: game.date,
    allDay: game.allDay,
    duration: game.duration,
    endsAt: Number.isFinite(end) ? new Date(end).toISOString() : null,
  });
}

function Meta({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
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

function BlockedUsersSection({ hostId }: { hostId: string }) {
  const blocked = useBlockedUsers(hostId);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (blocked.length === 0) return;
    const missing = blocked.filter((id) => !(id in names));
    if (missing.length === 0) return;
    let cancel = false;
    (async () => {
      const { data } = await supabase.from("profiles").select("id, display_name").in("id", missing);
      if (cancel || !data) return;
      const next: Record<string, string> = {};
      (data as { id: string; display_name: string | null }[]).forEach((r) => {
        next[r.id] = r.display_name ?? "Player";
      });
      setNames((n) => ({ ...n, ...next }));
    })();
    return () => {
      cancel = true;
    };
  }, [blocked, names]);

  if (!hostId) return null;

  return (
    <div className="mt-4 rounded-xl border border-border bg-background p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
        Blocked players
      </div>
      {blocked.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          You haven't blocked anyone. Use the Block button on a request or roster row to prevent a
          player from joining your games.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {blocked.map((id) => (
            <li key={id} className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold truncate">{names[id] ?? "Player"}</span>
              <button
                type="button"
                onClick={() => unblockUser(hostId, id)}
                className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-semibold hover:bg-secondary"
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RosterPlayerRow({
  req,
  gameTitle,
  feeRequired,
  onOptimistic,
}: {
  req: JoinRequest;
  gameTitle: string;
  feeRequired: boolean;
  onOptimistic: (reqId: string, status: "approved" | "rejected") => () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string>("Player");
  const [initials, setInitials] = useState<string>("P");
  const [latestSub, setLatestSub] = useState<{
    id: string;
    status: "verified" | "pending" | "rejected";
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
  const paymentStatus: "verified" | "pending" | "rejected" | "none" = latestSub?.status ?? "none";
  const reviews = useReviewsFor(req.player_id);
  const rep = useMemo(() => computeReputation(reviews, "player"), [reviews]);
  const reliability = rep.criteriaAverages.find((c) => c.key === "reliability")?.avg ?? 0;
  const sportsmanship = rep.criteriaAverages.find((c) => c.key === "sportsmanship")?.avg ?? 0;

  useEffect(() => {
    let cancel = false;
    const loadPayment = async () => {
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
        setLatestSub({ id: d.id, status: d.status, screenshot_path: d.screenshot_path });
      } else {
        setLatestSub(null);
      }
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
    } catch (e: any) {
      setLatestSub(prev);
      toast.error(e.message ?? "Could not update payment.");
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
    } catch (e: any) {
      toast.error(e.message ?? "Could not mark as paid.");
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
    } catch (e: any) {
      toast.error(e.message ?? "Could not load history.");
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
    } catch (e: any) {
      rollback();
      toast.error(e.message ?? "Could not remove.");
    } finally {
      setBusy(false);
    }
  };

  const removeAndBlock = async () => {
    if (!confirm(`Block ${name}? They won't be able to join your future games.`)) return;
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
      blockUser(req.host_id, req.player_id);
      await createNotification({
        user_id: req.player_id,
        type: "join_declined",
        title: `Removed from ${gameTitle}`,
        body: "The host removed you from this game.",
        link: `/games/${req.game_id}`,
      });
      toast.success(`${name} blocked.`);
    } catch (e: any) {
      rollback();
      toast.error(e.message ?? "Could not block.");
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
        <div className="flex flex-col gap-1.5">
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
      {feeRequired && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Verification history
          </div>
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

function HostRequestRow({
  req,
  gameTitle,
  ageReq,
  onOptimistic,
}: {
  req: JoinRequest;
  gameTitle: string;
  ageReq?: { minAge: number | null; maxAge: number | null };
  onOptimistic: (reqId: string, status: "approved" | "rejected") => () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string>("Player");
  const [age, setAge] = useState<number | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_initials")
        .eq("id", req.player_id)
        .maybeSingle();
      if (data) setName((data as any).display_name ?? "Player");
      const ages = await fetchProfileAges([req.player_id]);
      setAge(ages[req.player_id] ?? null);
    })();
  }, [req.player_id]);
  const ageLabel = requesterAgeLabel(age, ageReq);

  const act = async (status: "approved" | "rejected", reason?: string | null) => {
    setBusy(true);
    const rollback = onOptimistic(req.id, status);
    try {
      await reviewJoinRequest(req.id, status, reason ?? undefined);
      await createNotification({
        user_id: req.player_id,
        type: status === "approved" ? "join_approved" : "join_declined",
        title: status === "approved" ? `You're in: ${gameTitle}` : `Request declined: ${gameTitle}`,
        body:
          status === "approved"
            ? "The host approved your request."
            : reason
              ? `The host declined your request: ${reason}`
              : "The host declined your request.",
        link: `/games/${req.game_id}`,
      });
      toast.success(status === "approved" ? "Approved" : "Declined");
    } catch (e: any) {
      rollback();
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const promptRejection = (defaultReason?: string): string | null => {
    const raw = window.prompt(
      "Add a short reason for the player (optional). Leave blank to decline without a note.",
      defaultReason ?? "",
    );
    // `null` = user cancelled the prompt → abort. Empty string = decline with no reason.
    if (raw === null) return null;
    return raw.trim().slice(0, 500);
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
          {ageLabel && (
            <div className="text-[11px] font-semibold text-muted-foreground">🎂 {ageLabel}</div>
          )}
          {req.message && (
            <div className="text-xs text-muted-foreground truncate">"{req.message}"</div>
          )}
        </div>
        {req.status === "pending" ? (
          <div className="flex gap-1.5">
            <button
              disabled={busy}
              onClick={async () => {
                if (!confirm(`Block ${name}? They won't be able to join your future games.`))
                  return;
                await act("rejected", "Blocked by host");
                blockUser(req.host_id, req.player_id);
                toast.success(`${name} blocked.`);
              }}
              className="grid h-9 px-2 place-items-center rounded-xl border border-coral/60 bg-coral/10 text-coral text-[11px] font-bold disabled:opacity-50"
              title="Block from your games"
            >
              Block
            </button>
            <button
              disabled={busy}
              onClick={() => {
                const reason = promptRejection();
                if (reason === null) return;
                void act("rejected", reason || null);
              }}
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
  onOptimistic,
  index,
}: {
  req: JoinRequest;
  gameTitle: string;
  onOptimistic: (reqId: string, status: "approved" | "rejected") => () => void;
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

  const act = async (status: "approved" | "rejected", reason?: string | null) => {
    setBusy(true);
    const rollback = onOptimistic(req.id, status);
    setOpen(false);
    try {
      await reviewJoinRequest(req.id, status, reason ?? undefined);
      await createNotification({
        user_id: req.player_id,
        type: status === "approved" ? "join_approved" : "join_declined",
        title: status === "approved" ? `You're in: ${gameTitle}` : `Request declined: ${gameTitle}`,
        body:
          status === "approved"
            ? "The host approved your request."
            : reason
              ? `The host declined your request: ${reason}`
              : "The host declined your request.",
        link: `/games/${req.game_id}`,
      });
      toast.success(status === "approved" ? `Approved ${name}` : `Declined ${name}`);
    } catch (e: any) {
      rollback();
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const promptRejection = (): string | null => {
    const raw = window.prompt(
      "Add a short reason for the player (optional). Leave blank to decline without a note.",
      "",
    );
    if (raw === null) return null;
    return raw.trim().slice(0, 500);
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
          <div className="flex flex-col gap-1.5 mt-1">
            <div className="flex gap-1.5">
              <button
                disabled={busy}
                onClick={() => {
                  const reason = promptRejection();
                  if (reason === null) return;
                  void act("rejected", reason || null);
                }}
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
            <button
              disabled={busy}
              onClick={async () => {
                if (!confirm(`Block ${name}? They won't be able to join your future games.`))
                  return;
                await act("rejected", "Blocked by host");
                blockUser(req.host_id, req.player_id);
                toast.success(`${name} blocked.`);
              }}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-coral/60 bg-coral/10 text-coral py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              Block from your games
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
