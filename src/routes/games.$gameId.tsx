import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowLeft, Share2, Bookmark, MapPin, Clock, Users, Calendar, MessageCircle, Star, Check, CreditCard, Settings as SettingsIcon, X as XIcon } from "lucide-react";
import { GAMES, SPORTS } from "@/lib/sample-data";
import { formatWhen } from "@/lib/format";
import { ReviewsSection } from "@/components/ReviewsSection";
import { computeReputation, useReviewsFor } from "@/lib/reviews";
import { ReputationBadge } from "@/components/ReputationBadge";
import { joinGame, leaveGame, useIsJoined } from "@/lib/games-store";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { getGamePaymentSettings, listMySubmissionsForGame, deleteMyPendingSubmission, getMyJoinRequest, createJoinRequest, cancelMyJoinRequest, listHostJoinRequests, reviewJoinRequest, upsertGamePaymentSettings, type GamePaymentSettings, type PaymentSubmission, type JoinRequest } from "@/lib/payments";
import { useHostedGames } from "@/lib/hosted-games-store";
import type { Game } from "@/lib/sample-data";
import { LegalNotice } from "@/components/LegalNotice";
import { useAuth } from "@/hooks/use-auth";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { createNotification } from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { useCanReview } from "@/lib/transactions";

const emojiBySport: Record<string, string> = Object.fromEntries(SPORTS.map((s) => [s.name, s.emoji]));

const hostIdFor = (username: string) => `host-${username.replace(/^@/, "").toLowerCase()}`;

export const Route = createFileRoute("/games/$gameId")({
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
        <Link to="/feed" className="inline-block mt-5 rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-primary-foreground">
          Back to feed
        </Link>
      </div>
    </div>
  ),
  errorComponent: ({ reset }) => (
    <div className="min-h-dvh grid place-items-center px-6 text-center">
      <div>
        <h1 className="font-display text-2xl font-bold">Something went wrong</h1>
        <button onClick={reset} className="mt-4 rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-primary-foreground">Try again</button>
      </div>
    </div>
  ),
  component: GameDetail,
});

function GameDetail() {
  const { gameId } = Route.useLoaderData();
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

  const effectiveJoined = (game?.joined ?? 0) + (joined ? 1 : 0);
  const spotsLeft = game ? Math.max(0, game.maxPlayers - effectiveJoined) : 0;
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
      setSettings(s); setMySubs(subs); setMyReq(req);
      if (req?.status === "approved" && !joined) joinGame(game.id);
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
    } catch (e: any) { toast.error(e.message ?? "Could not update."); }
    finally { setApprovalSaving(false); }
  };

  useEffect(() => { refreshStatus(); /* eslint-disable-next-line */ }, [game?.id]);
  useEffect(() => { refreshHostRequests(); /* eslint-disable-next-line */ }, [game?.id, user?.id, settings?.host_id, hostsThisGame]);

  if (!game) {
    return (
      <div className="min-h-dvh grid place-items-center px-6 text-center">
        <div>
          <h1 className="font-display text-3xl font-bold">Game not found</h1>
          <p className="text-muted-foreground mt-2">It may have wrapped up or been cancelled.</p>
          <Link to="/feed" className="inline-block mt-5 rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-primary-foreground">
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
  const isConfirmed = latestSub?.status === "verified" || myReq?.status === "approved";
  const isPending = latestSub?.status === "pending" || (requiresApproval && myReq?.status === "pending");

  const handleJoin = async () => {
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
      } catch (e: any) { toast.error(e.message ?? "Could not leave."); }
      return;
    }
    // Pending → cancel request / withdraw submission
    if (isPending) {
      try {
        if (latestSub?.status === "pending") await deleteMyPendingSubmission(latestSub.id);
        if (myReq?.status === "pending") await cancelMyJoinRequest(game.id);
        toast("Request canceled.");
        refreshStatus();
      } catch (e: any) { toast.error(e.message ?? "Could not cancel."); }
      return;
    }
    if (spotsLeft <= 0) { toast.error("This game is full."); return; }
    if (isPaid) { nav({ to: "/games/$gameId/pay", params: { gameId: game.id } }); return; }
    if (requiresApproval) {
      if (!settings) { toast.error("Host hasn't enabled approvals yet."); return; }
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
      } catch (e: any) { toast.error(e.message ?? "Could not send request."); }
      return;
    }
    joinGame(game.id);
    toast.success(`You're in! See you at ${game.location}.`);
  };




  const players = [
    ...(joined ? [{ initials: "YOU", isMe: true }] : []),
    ...Array.from({ length: game.joined }, (_, i) => ({
      initials: ["MC", "AG", "JK", "RC", "TB", "SO", "PN", "DP", "EL", "VM"][i % 10],
      isMe: false,
    })),
  ];

  return (
    <div className="pb-32">
      {/* Hero */}
      <div className="relative h-72">
        <img src={game.image} alt={game.title} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-background/40" />
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
          <Link to="/feed" className="grid h-10 w-10 place-items-center rounded-full border border-border bg-background/70 backdrop-blur">
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
            <span className="rounded-full bg-background/70 backdrop-blur px-3 py-1 text-xs font-semibold">{game.skill}</span>
            {game.urgent && (
              <span className="rounded-full bg-coral-gradient px-3 py-1 text-xs font-bold text-white">⚡ {spotsLeft} spots left</span>
            )}
          </div>
          <h1 className="font-display text-3xl font-bold drop-shadow-lg">{game.title}</h1>
        </div>
      </div>

      <div className="mx-auto max-w-md px-4 mt-5 space-y-5">
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
              <X className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
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
                  : (myReq.reviewer_notes || "The host declined this request. You can message them or find another run.")}
              </p>
            </div>
          </div>
        )}

        {/* Meta */}
        <div className="grid grid-cols-2 gap-2">
          <Meta icon={<Clock className="h-4 w-4 text-lime" />} label="Starts" value={formatWhen(game.date)} />
          <Meta icon={<Calendar className="h-4 w-4 text-lime" />} label="Duration" value={game.duration} />
          <Meta icon={<Users className="h-4 w-4 text-coral" />} label="Players" value={`${effectiveJoined} / ${game.maxPlayers}`} />
          <Meta icon={<MapPin className="h-4 w-4 text-coral" />} label="Distance" value={`${game.distanceMi} mi`} />
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
                  <path d="M 32 0 L 0 0 0 32" fill="none" stroke="oklch(1 0 0 / 0.1)" strokeWidth="1" />
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
            <div className="text-sm text-muted-foreground">{game.neighborhood} · {game.indoor ? "Indoor" : "Outdoor"}</div>
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
              ? { to: "/players/$userId", params: { userId: hostId }, className: "hover:text-lime hover:underline" }
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
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Hosted by</div>
                  <div className="font-semibold">
                    <NameTag {...nameProps}>{game.host.name}</NameTag>{" "}
                    <span className="text-muted-foreground font-normal text-sm">{game.host.username}</span>
                  </div>
                  <div className="text-xs text-lime font-semibold">★ {game.host.rating} host rating</div>
                </div>
              </>
            );
          })()}
          {canReviewHost ? (
            <Link
              to="/review/new"
              search={{
                revieweeId: hostIdFor(game.host.username),
                revieweeKind: "host",
                revieweeName: game.host.name,
                kind: "player",
                context: game.title,
              } as any}
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
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">About the run</h2>
          <p className="text-sm leading-relaxed">{game.description}</p>
          {game.equipment.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {game.equipment.map((e: string) => (
                <span key={e} className="rounded-full border border-border bg-surface px-3 py-1 text-xs">{e}</span>
              ))}
            </div>
          )}
        </div>

        {/* Players */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Roster ({effectiveJoined}/{game.maxPlayers})
            </h2>
            <button className="text-xs font-semibold text-lime">See all</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {players.map((p, i) => (
              <motion.div
                key={i}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: i * 0.04 }}
                className={`grid h-11 w-11 place-items-center rounded-full border text-xs font-bold ${
                  p.isMe ? "border-lime bg-lime/15 text-lime" : "border-border bg-surface"
                }`}
              >
                {p.initials}
              </motion.div>
            ))}
            {Array.from({ length: spotsLeft }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="grid h-11 w-11 place-items-center rounded-full border-2 border-dashed border-border bg-transparent text-muted-foreground text-lg"
              >
                +
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Host controls */}
      {isHost && (
        <div className="mx-auto max-w-md px-4 mt-4 space-y-3">
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
            <div className={`shrink-0 grid h-7 w-12 items-center rounded-full p-0.5 transition-colors ${settings?.requires_approval ? "bg-lime" : "bg-secondary"}`}>
              <div className={`h-6 w-6 rounded-full bg-background shadow transition-transform ${settings?.requires_approval ? "translate-x-5" : ""}`} />
            </div>
          </button>

          {hostRequests.length > 0 ? (
            <div>
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Pickup requests · {hostRequests.filter((r) => r.status === "pending").length} pending
              </h2>
              <div className="space-y-2">
                {hostRequests.map((r) => (
                  <HostRequestRow key={r.id} req={r} gameTitle={game.title} onChange={refreshHostRequests} />
                ))}
              </div>
            </div>
          ) : settings?.requires_approval ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-3 text-xs text-muted-foreground">
              No pickup requests yet. You'll see them here as players ask to join.
            </div>
          ) : null}
        </div>
      )}

      {/* Host-only payment setup link */}
      <div className="mx-auto max-w-md px-4 mt-4">
        <Link to="/games/$gameId/payment-setup" params={{ gameId: game.id }}
          className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-surface/40 p-3 text-xs text-muted-foreground hover:border-lime/40">
          <SettingsIcon className="h-4 w-4 text-lime" />
          <span className="flex-1">Host of this game? Configure payment methods & fee.</span>
          <span className="text-lime">→</span>
        </Link>
        <div className="mt-3"><LegalNotice compact /></div>
      </div>

      {/* Sticky CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-30 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur-xl bg-background/80 border-t border-border">
        <div className="mx-auto max-w-md flex items-center gap-2">
          <button
            disabled={messaging}
            onClick={async () => {
              if (!user) { nav({ to: "/auth" }); return; }
              const hostUid = settings?.host_id;
              if (!hostUid) { toast.error("This host can't be messaged yet."); return; }
              if (hostUid === user.id) { nav({ to: "/messages" }); return; }
              setMessaging(true);
              try {
                const cid = await getOrCreateDirectConversation(hostUid, game.id);
                nav({ to: "/messages/$conversationId", params: { conversationId: cid } });
              } catch (e: any) { toast.error(e.message); }
              finally { setMessaging(false); }
            }}
            className="grid h-12 w-12 place-items-center rounded-2xl border border-border bg-surface disabled:opacity-50">
            <MessageCircle className="h-5 w-5" />
          </button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleJoin}
            disabled={!joined && !isPending && !isConfirmed && spotsLeft <= 0}
            className={`flex-1 rounded-2xl py-3.5 font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${
              isConfirmed ? "bg-lime/15 border border-lime/40 text-lime" :
              isPending ? "bg-surface border border-coral/40 text-coral" :
              joined ? "bg-surface border border-lime/40 text-lime" :
              "bg-lime-gradient text-primary-foreground glow-lime"
            }`}
          >
            {isConfirmed ? (
              <><Check className="h-4 w-4" /> Confirmed · Tap to leave</>
            ) : isPending ? (
              <><Clock className="h-4 w-4" /> {latestSub?.status === "pending" ? "Payment pending · Tap to withdraw" : "Request pending · Tap to cancel"}</>

            ) : joined && !isPaid ? (
              <><Check className="h-4 w-4" /> You're in · Tap to leave</>
            ) : spotsLeft <= 0 ? (
              <>Full</>
            ) : isPaid ? (
              <><CreditCard className="h-4 w-4" /> Pay host · ${fee.toFixed(2)}</>
            ) : requiresApproval ? (
              <>Request to join · {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left</>
            ) : (
              <>Join free · {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left</>
            )}
          </motion.button>
        </div>
      </div>
    </div>
  );
}


function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}{label}
      </div>
      <div className="mt-0.5 font-semibold text-sm">{value}</div>
    </div>
  );
}

function HostRequestRow({ req, gameTitle, onChange }: { req: JoinRequest; gameTitle: string; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string>("Player");
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("display_name, avatar_initials").eq("id", req.player_id).maybeSingle();
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
        body: status === "approved" ? "The host approved your request." : "The host declined your request.",
        link: `/games/${req.game_id}`,
      });
      toast.success(status === "approved" ? "Approved" : "Declined");
      onChange();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className={`rounded-2xl border p-3 ${req.status === "pending" ? "border-border bg-surface" : "border-border/50 bg-surface/40 opacity-70"}`}>
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
          {req.message && <div className="text-xs text-muted-foreground truncate">"{req.message}"</div>}
        </div>
        {req.status === "pending" ? (
          <div className="flex gap-1.5">
            <button disabled={busy} onClick={() => act("rejected")} className="grid h-9 w-9 place-items-center rounded-xl border border-coral/40 text-coral disabled:opacity-50"><XIcon className="h-4 w-4" /></button>
            <button disabled={busy} onClick={() => act("approved")} className="grid h-9 w-9 place-items-center rounded-xl bg-lime-gradient text-primary-foreground disabled:opacity-50"><Check className="h-4 w-4" /></button>
          </div>
        ) : (
          <span className="text-xs font-semibold uppercase">{req.status}</span>
        )}
      </div>
    </div>
  );
}
