import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowLeft, Share2, Bookmark, MapPin, Clock, Users, Calendar, MessageCircle, Star, Check, CreditCard, Settings as SettingsIcon } from "lucide-react";
import { GAMES, SPORTS } from "@/lib/sample-data";
import { formatWhen } from "@/lib/format";
import { ReviewsSection } from "@/components/ReviewsSection";
import { computeReputation, useReviewsFor } from "@/lib/reviews";
import { ReputationBadge } from "@/components/ReputationBadge";
import { joinGame, leaveGame, useIsJoined } from "@/lib/games-store";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { getGamePaymentSettings, listMySubmissionsForGame, deleteMyPendingSubmission, getMyJoinRequest, createJoinRequest, cancelMyJoinRequest, type GamePaymentSettings, type PaymentSubmission, type JoinRequest } from "@/lib/payments";
import { LegalNotice } from "@/components/LegalNotice";

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
  const { game } = Route.useLoaderData();
  const joined = useIsJoined(game.id);
  const effectiveJoined = game.joined + (joined ? 1 : 0);
  const spotsLeft = Math.max(0, game.maxPlayers - effectiveJoined);
  const nav = useNavigate();
  const [settings, setSettings] = useState<GamePaymentSettings | null>(null);
  const [mySubs, setMySubs] = useState<PaymentSubmission[]>([]);
  const [myReq, setMyReq] = useState<JoinRequest | null>(null);

  const refreshStatus = async () => {
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
  useEffect(() => { refreshStatus(); /* eslint-disable-next-line */ }, [game.id]);

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
        toast.success("Request sent. The host will review it.");
        refreshStatus();
      } catch (e: any) { toast.error(e.message ?? "Could not send request."); }
      return;
    }
    joinGame(game.id);
    toast.success(`You're in! See you at ${game.location}.`);
  };

  const hostReviews = useReviewsFor(hostIdFor(game.host.username));
  const hostRep = useMemo(() => computeReputation(hostReviews, "host"), [hostReviews]);

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
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-lime-gradient font-bold text-primary-foreground">
            {game.host.avatar}
          </div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Hosted by</div>
            <div className="font-semibold">{game.host.name} <span className="text-muted-foreground font-normal text-sm">{game.host.username}</span></div>
            <div className="text-xs text-lime font-semibold">★ {game.host.rating} host rating</div>
          </div>
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
          <button className="grid h-12 w-12 place-items-center rounded-2xl border border-border bg-surface">
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
              <><Clock className="h-4 w-4" /> {requiresApproval && !isPaid ? "Request pending · Tap to cancel" : "Payment pending · Tap to withdraw"}</>
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
