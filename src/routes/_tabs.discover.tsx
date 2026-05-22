import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Navigation } from "lucide-react";
import { GAMES, SPORTS } from "@/lib/sample-data";
import { formatWhen } from "@/lib/format";

export const Route = createFileRoute("/_tabs/discover")({
  head: () => ({ meta: [{ title: "Discover — OpenRun" }] }),
  component: Discover,
});

const emojiBySport: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.name, s.emoji]),
);

function Discover() {
  const [active, setActive] = useState(GAMES[0].id);
  const activeGame = GAMES.find((g) => g.id === active)!;

  return (
    <div className="relative h-dvh overflow-hidden">
      {/* Faux map background */}
      <div className="absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 30% 30%, oklch(0.28 0.08 200 / 0.55), transparent 60%), radial-gradient(50% 40% at 80% 70%, oklch(0.30 0.08 145 / 0.45), transparent 60%), linear-gradient(180deg, oklch(0.18 0.03 240), oklch(0.14 0.03 250))",
          }}
        />
        <svg className="absolute inset-0 h-full w-full opacity-25" aria-hidden>
          <defs>
            <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
              <path d="M 44 0 L 0 0 0 44" fill="none" stroke="oklch(1 0 0 / 0.08)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          {/* Faux roads */}
          <path d="M 0 60% Q 30% 50%, 60% 55% T 100% 50%" stroke="oklch(1 0 0 / 0.15)" strokeWidth="14" fill="none" />
          <path d="M 30% 0 Q 35% 40%, 50% 50% T 70% 100%" stroke="oklch(1 0 0 / 0.10)" strokeWidth="10" fill="none" />
          <path d="M 0 25% L 100% 30%" stroke="oklch(1 0 0 / 0.08)" strokeWidth="6" fill="none" />
        </svg>
      </div>

      {/* Top overlay */}
      <div className="relative z-10 px-4 pt-6">
        <div className="rounded-2xl border border-border bg-surface/80 backdrop-blur-xl p-3 shadow-xl">
          <div className="flex items-center gap-2 text-sm">
            <Navigation className="h-4 w-4 text-lime" />
            <span className="font-semibold">East Village, NY</span>
            <span className="text-muted-foreground">· {GAMES.length} games within 5 mi</span>
          </div>
        </div>
      </div>

      {/* Pins */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        {GAMES.map((g, i) => (
          <motion.button
            key={g.id}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: i * 0.05, type: "spring", stiffness: 250, damping: 15 }}
            onClick={() => setActive(g.id)}
            className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${g.lng}%`, top: `${g.lat}%` }}
          >
            <div
              className={`relative grid h-11 w-11 place-items-center rounded-full border-2 transition-all ${
                active === g.id
                  ? "bg-lime border-lime text-primary-foreground scale-110 glow-lime"
                  : "bg-background/90 backdrop-blur border-border text-foreground hover:border-lime"
              }`}
            >
              <span className="text-lg">{emojiBySport[g.sport]}</span>
              {g.urgent && (
                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-coral animate-pulse border-2 border-background" />
              )}
            </div>
            {active === g.id && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: [1, 1.6, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute inset-0 -z-10 rounded-full bg-lime/40"
              />
            )}
          </motion.button>
        ))}
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
