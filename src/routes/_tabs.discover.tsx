import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Navigation } from "lucide-react";
import { GAMES, SPORTS } from "@/lib/sample-data";
import { formatWhen } from "@/lib/format";
import { GamesMap, type MapPinItem } from "@/components/GamesMap";
import { useMyProfile } from "@/lib/user-prefs-store";
import { useHostedGames } from "@/lib/hosted-games-store";
import { useAuth } from "@/hooks/use-auth";
import { useLiveParticipantCount } from "@/lib/game-participants-store";
import { computeSpotsLeft } from "@/lib/spots-left";

export const Route = createFileRoute("/_tabs/discover")({
  head: () => ({ meta: [{ title: "Discover — OpenRun" }] }),
  component: Discover,
});

const emojiBySport: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.name, s.emoji]),
);

function Discover() {
  const { user } = useAuth();
  const profile = useMyProfile(user);
  const hosted = useHostedGames();
  const allGames = useMemo(() => [...hosted, ...GAMES], [hosted]);
  const [active, setActive] = useState<string>(allGames[0]?.id ?? "");
  const [visibleIds, setVisibleIds] = useState<string[] | null>(null);
  const visibleGames = useMemo(
    () => (visibleIds ? allGames.filter((g) => visibleIds.includes(g.id)) : allGames),
    [visibleIds, allGames],
  );
  const activeGame = visibleGames.find((g) => g.id === active) ?? visibleGames[0] ?? null;

  const pins: MapPinItem[] = useMemo(
    () =>
      allGames.map((g) => ({
        id: g.id,
        emoji: emojiBySport[g.sport] ?? "📍",
        lat: g.lat,
        lng: g.lng,
        urgent: g.urgent,
      })),
    [allGames],
  );

  return (
    <div className="relative h-dvh overflow-hidden">
      {/* Real Google Map with live GPS */}
      <GamesMap
        pins={pins}
        activeId={active}
        onSelect={setActive}
        defaultLocation={profile?.city}
        onVisibleChange={(ids) => {
          setVisibleIds(ids);
          if (ids.length && !ids.includes(active)) setActive(ids[0]);
        }}
      />

      {/* Top overlay */}
      <div className="relative z-10 px-4 pt-6">
        <div className="rounded-2xl border border-border bg-surface/80 backdrop-blur-xl p-3 shadow-xl">
          <div className="flex items-center gap-2 text-sm">
            <Navigation className="h-4 w-4 text-lime" />
            <span className="font-semibold">{visibleIds ? "This area" : "Live location"}</span>
            <span className="text-muted-foreground">
              · {visibleGames.length} game{visibleGames.length === 1 ? "" : "s"}{" "}
              {visibleIds ? "in view" : "nearby"}
            </span>
            {visibleIds && (
              <button
                onClick={() => setVisibleIds(null)}
                className="ml-auto text-xs font-bold text-lime"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom card */}
      <div className="absolute bottom-24 left-0 right-0 z-20 px-4">
        <AnimatePresence mode="wait">
          {activeGame ? (
            <ActiveGameCard key={activeGame.id} game={activeGame} />
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              className="rounded-3xl border border-border bg-surface/90 backdrop-blur-xl p-4 text-center text-sm text-muted-foreground shadow-2xl"
            >
              No games in this area. Pan the map or{" "}
              <button onClick={() => setVisibleIds(null)} className="font-bold text-lime">
                reset
              </button>
              .
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

type ActiveGame = {
  id: string;
  image: string;
  sport: string;
  skill: string;
  title: string;
  location: string;
  date: string;
  maxPlayers: number;
  joined: number;
};

function ActiveGameCard({ game }: { game: ActiveGame }) {
  const liveCount = useLiveParticipantCount(game.id);
  const spotsLeft = computeSpotsLeft(game.maxPlayers, game.joined, liveCount);
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      transition={{ type: "spring", stiffness: 240, damping: 24 }}
    >
      <Link
        to="/games/$gameId"
        params={{ gameId: game.id }}
        className="flex gap-3 rounded-3xl border border-border bg-surface/90 backdrop-blur-xl p-3 shadow-2xl"
      >
        <img
          src={game.image}
          alt=""
          loading="lazy"
          className="h-20 w-20 rounded-2xl object-cover"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs">
            <span>{emojiBySport[game.sport]}</span>
            <span className="font-semibold">{game.sport}</span>
            <span className="text-muted-foreground">· {game.skill}</span>
          </div>
          <h3 className="font-display text-base font-bold truncate">{game.title}</h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <MapPin className="h-3.5 w-3.5" />
            <span className="truncate">{game.location}</span>
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs">{formatWhen(game.date)}</span>
            <SpotsPill spotsLeft={spotsLeft} />

          </div>
        </div>
      </Link>
    </motion.div>
  );
}
