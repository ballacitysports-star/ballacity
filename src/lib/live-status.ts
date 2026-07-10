import { useEffect, useState } from "react";
import type { Game } from "@/lib/sample-data";

/** Parse "90 min" / "2 h" / "1.5 hr" into minutes. Defaults to 90. */
function parseDurationMin(duration: string | undefined): number {
  if (!duration) return 90;
  const m = duration.match(/([\d.]+)\s*(h|hr|hour|min|m)?/i);
  if (!m) return 90;
  const n = parseFloat(m[1]);
  const unit = (m[2] || "min").toLowerCase();
  if (unit.startsWith("h")) return Math.round(n * 60);
  return Math.round(n);
}

export type LiveStatus = "scheduled" | "in_progress" | "completed";

export function computeLiveStatus(game: Game, now: number = Date.now()): LiveStatus {
  // Respect an explicit host-set status when present.
  if (game.status === "in_progress" || game.status === "completed") return game.status;
  const start = new Date(game.date).getTime();
  if (Number.isNaN(start)) return "scheduled";
  const end = start + parseDurationMin(game.duration) * 60_000;
  if (now < start) return "scheduled";
  if (now < end) return "in_progress";
  return "completed";
}

/** Global 30s ticker so every subscriber re-renders together. */
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function ensureTicker() {
  if (tickTimer || typeof window === "undefined") return;
  tickTimer = setInterval(() => {
    tickListeners.forEach((cb) => cb());
  }, 30_000);
}

export function useLiveStatus(game: Game): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>(() => computeLiveStatus(game));
  useEffect(() => {
    ensureTicker();
    const cb = () => setStatus(computeLiveStatus(game));
    cb();
    tickListeners.add(cb);
    return () => {
      tickListeners.delete(cb);
    };
  }, [game]);
  return status;
}
