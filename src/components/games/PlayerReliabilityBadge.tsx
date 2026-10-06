import { CheckCircle2, AlertTriangle, Sparkles } from "lucide-react";
import {
  summarizeReliability,
  usePlayerReliability,
  type ReliabilityTier,
} from "@/lib/player-reliability";

const TIER_STYLE: Record<ReliabilityTier, string> = {
  high: "bg-lime/15 text-lime",
  caution: "bg-amber-500/15 text-amber-500",
  new: "bg-secondary text-muted-foreground",
};

const TIER_ICON = {
  high: CheckCircle2,
  caution: AlertTriangle,
  new: Sparkles,
} as const;

/**
 * Compact attendance pill for hosts vetting a join request or waitlist entry.
 * Renders nothing while loading or when the viewer isn't allowed to see the
 * player's record (the server decides; this is not an authorization boundary).
 */
export function PlayerReliabilityBadge({
  userId,
  className = "",
}: {
  userId: string;
  className?: string;
}) {
  const { data } = usePlayerReliability(userId);
  if (!data) return null;
  const summary = summarizeReliability(data);
  const Icon = TIER_ICON[summary.tier];
  return (
    <span
      title="Attendance on BallaCity: games attended, no-shows and late drops"
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${TIER_STYLE[summary.tier]} ${className}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {summary.label}
    </span>
  );
}
