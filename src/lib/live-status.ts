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

// ---------- Signup gate (blackout window + in-progress lockout) ----------

export const SIGNUP_CUTOFF_PRESETS: { value: number; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 15, label: "15 min before" },
  { value: 30, label: "30 min before" },
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 1440, label: "24 hours before" },
];

export function cutoffLabel(min: number | undefined): string {
  const m = Number(min ?? 0);
  return SIGNUP_CUTOFF_PRESETS.find((p) => p.value === m)?.label ?? `${m} min before`;
}

/** Human phrase for the cutoff amount, e.g. "30 min", "1 hour". */
export function cutoffAmountLabel(min: number | undefined): string {
  const m = Number(min ?? 0);
  if (m <= 0) return "";
  if (m % 1440 === 0) return `${m / 1440} day${m / 1440 > 1 ? "s" : ""}`;
  if (m % 60 === 0) return `${m / 60} hour${m / 60 > 1 ? "s" : ""}`;
  return `${m} min`;
}

export type JoinState =
  | "open"
  | "roster_full"
  | "closed_cutoff"
  | "closed_by_host"
  | "in_progress"
  | "completed";

export type JoinGateOptions = {
  /** Remaining spots on the roster. Omit when unknown. */
  spotsLeft?: number;
};

export type JoinGate = {
  liveStatus: LiveStatus;
  joinState: JoinState;
  /** Short badge / CTA label. */
  label: string;
  /** Longer explanation for helper text and toasts. */
  reason: string;
  /** True when new joins, position picks and waitlist sign-ups are blocked. */
  locked: boolean;
};

export function resolveJoinGate(
  game: Game,
  now: number = Date.now(),
  opts: JoinGateOptions = {},
): JoinGate {
  const liveStatus = computeLiveStatus(game, now);
  const cutoffMin = Number((game as { signupCutoffMin?: number }).signupCutoffMin ?? 0);

  if (liveStatus === "completed") {
    return {
      liveStatus,
      joinState: "completed",
      label: "Ended",
      reason: "This game has ended.",
      locked: true,
    };
  }
  if (liveStatus === "in_progress") {
    return {
      liveStatus,
      joinState: "in_progress",
      label: "In progress",
      reason: "This game is in progress — signups are closed.",
      locked: true,
    };
  }
  if (game.joinsClosed) {
    return {
      liveStatus,
      joinState: "closed_by_host",
      label: "Signup closed",
      reason: "The host has closed joining for this game.",
      locked: true,
    };
  }
  const start = new Date(game.date).getTime();
  if (cutoffMin > 0 && !Number.isNaN(start) && now >= start - cutoffMin * 60_000) {
    return {
      liveStatus,
      joinState: "closed_cutoff",
      label: "Signup closed",
      reason: `Signups closed ${cutoffAmountLabel(cutoffMin)} before start.`,
      locked: true,
    };
  }
  if (opts.spotsLeft !== undefined && opts.spotsLeft <= 0) {
    return {
      liveStatus,
      joinState: "roster_full",
      label: "Roster full",
      reason: "The roster is full — no spots left.",
      locked: true,
    };
  }
  return { liveStatus, joinState: "open", label: "Open", reason: "", locked: false };
}

/** Live-updating variant of `resolveJoinGate` (shares the 30s ticker). */
export function useJoinGate(game: Game, opts: JoinGateOptions = {}): JoinGate {
  const spotsLeft = opts.spotsLeft;
  const [gate, setGate] = useState<JoinGate>(() =>
    resolveJoinGate(game, Date.now(), { spotsLeft }),
  );
  useEffect(() => {
    ensureTicker();
    const cb = () => setGate(resolveJoinGate(game, Date.now(), { spotsLeft }));
    cb();
    tickListeners.add(cb);
    return () => {
      tickListeners.delete(cb);
    };
  }, [game, spotsLeft]);
  return gate;
}
