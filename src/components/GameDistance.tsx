import { MapPin } from "lucide-react";
import { Distance } from "@/components/Distance";
import { useGameDistance } from "@/lib/game-distance";
import type { Game } from "@/lib/sample-data";

/**
 * Renders the real distance between the viewer and a game's venue.
 *
 * Falls back to an "Enable location" affordance when the browser hasn't shared
 * a position yet, and to the venue's name-only state when the game has no
 * coordinates — never a made-up number.
 */
export function GameDistance({
  game,
  decimals,
  className,
  showPrompt = true,
}: {
  game: Pick<Game, "lat" | "lng" | "pseudoGeo" | "distanceMi">;
  decimals?: number;
  className?: string;
  /** Show a tappable "Enable location" hint when we lack the viewer's position. */
  showPrompt?: boolean;
}) {
  const { mi, reason, status, requestLocation } = useGameDistance(game);

  if (mi != null) {
    return (
      <span className={className}>
        <Distance mi={mi} decimals={decimals ?? (mi < 10 ? 1 : 0)} />
      </span>
    );
  }

  if (reason === "no-viewer-location" && showPrompt && status !== "unsupported") {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          requestLocation();
        }}
        className={`underline decoration-dotted underline-offset-2 ${className ?? ""}`}
      >
        {status === "prompting" ? "Locating…" : "Enable location"}
      </button>
    );
  }

  return <span className={className}>Distance unavailable</span>;
}

/** Convenience: pin icon + distance, the pattern used on cards. */
export function GameDistanceChip({
  game,
  className,
}: {
  game: Pick<Game, "lat" | "lng" | "pseudoGeo" | "distanceMi">;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      <MapPin className="h-3.5 w-3.5 shrink-0 text-coral" />
      <GameDistance game={game} />
    </span>
  );
}
