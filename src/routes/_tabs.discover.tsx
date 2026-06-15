import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Navigation } from "lucide-react";
import { GAMES, SPORTS } from "@/lib/sample-data";
import { formatWhen } from "@/lib/format";
import { GamesMap, type MapPinItem } from "@/components/GamesMap";
import { useMyProfile } from "@/lib/user-prefs-store";
import { useAuth } from "@/hooks/use-auth";

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
  const [active, setActive] = useState(GAMES[0].id);
  const [visibleIds, setVisibleIds] = useState<string[] | null>(null);
  const visibleGames = useMemo(
    () => (visibleIds ? GAMES.filter((g) => visibleIds.includes(g.id)) : GAMES),
    [visibleIds],
  );
  const activeGame = visibleGames.find((g) => g.id === active) ?? visibleGames[0] ?? GAMES[0];

  const pins: MapPinItem[] = useMemo(
    () =>
      GAMES.map((g) => ({
        id: g.id,
        emoji: emojiBySport[g.sport] ?? "📍",
        lat: g.lat,
        lng: g.lng,
        urgent: g.urgent,
      })),
    [],
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
            <span className="text-muted-foreground">· {visibleGames.length} games {visibleIds ? "in view" : "nearby"}</span>
          </div>
        </div>
      </div>



      {/* Bottom card */}
      <div className="absolute bottom-24 left-0 right-0 z-20 px-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeGame.id}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            transition={{ type: "spring", stiffness: 240, damping: 24 }}
          >
            <Link
              to="/games/$gameId"
              params={{ gameId: activeGame.id }}
              className="flex gap-3 rounded-3xl border border-border bg-surface/90 backdrop-blur-xl p-3 shadow-2xl"
            >
              <img
                src={activeGame.image}
                alt=""
                loading="lazy"
                className="h-20 w-20 rounded-2xl object-cover"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span>{emojiBySport[activeGame.sport]}</span>
                  <span className="font-semibold">{activeGame.sport}</span>
                  <span className="text-muted-foreground">· {activeGame.skill}</span>
                </div>
                <h3 className="font-display text-base font-bold truncate">{activeGame.title}</h3>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  <MapPin className="h-3.5 w-3.5" />
                  <span className="truncate">{activeGame.location}</span>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-xs">{formatWhen(activeGame.date)}</span>
                  <span className="rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-bold text-primary-foreground">
                    {activeGame.maxPlayers - activeGame.joined} spots
                  </span>
                </div>
              </div>
            </Link>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
