import { MapPin } from "lucide-react";
import { Distance } from "@/components/Distance";
import { useGameDistance } from "@/lib/game-distance";
import type { Game } from "@/lib/sample-data";

type GameGeo = Pick<Game, "lat" | "lng" | "pseudoGeo" | "distanceMi">;

/**
 * Renders the real distance between the viewer and a game's venue.
 *
 * Every distance in the app reads from one shared viewer-location store, so the
 * number here is byte-for-byte the value feed sorting uses. When we can't
 * measure it we say why instead of inventing a number:
 *  - no position yet → tappable "Enable location"
 *  - permission denied → "Retry location" (re-requests; explains the block)
 *  - venue never geocoded → "Distance unavailable"
 * A remembered last-granted fix keeps distances visible and is labelled as such.
 */
export function GameDistance({
  game,
  decimals,
  className,
  showPrompt = true,
}: {
  game: GameGeo;
  decimals?: number;
  className?: string;
  /** Show a tappable "Enable location" hint when we lack the viewer's position. */
  showPrompt?: boolean;
}) {
  const { mi, reason, status, remembered, explanation, requestLocation } = useGameDistance(game);

  const prompt = (label: string, title: string) => (
    <button
      type="button"
      title={title}
      aria-label={`${label}. ${title}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        requestLocation();
      }}
      className={`underline decoration-dotted underline-offset-2 ${className ?? ""}`}
    >
      {status === "prompting" ? "Locating…" : label}
    </button>
  );

  if (mi != null) {
    const value = (
      <span className={className} title={explanation ?? undefined}>
        <Distance mi={mi} decimals={decimals ?? (mi < 10 ? 1 : 0)} />
        {remembered ? <span className="ml-1 opacity-70">· approx</span> : null}
      </span>
    );
    if (!remembered || !showPrompt) return value;
    return (
      <span className="inline-flex items-center gap-1">
        {value}
        <button
          type="button"
          title="Refresh your location for an exact distance."
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            requestLocation();
          }}
          className="text-[11px] underline decoration-dotted underline-offset-2 opacity-70"
        >
          {status === "prompting" ? "Locating…" : "Refresh"}
        </button>
      </span>
    );
  }

  if (reason === "no-viewer-location" && showPrompt && status !== "unsupported") {
    const label = status === "denied" ? "Retry location" : "Enable location";
    return prompt(label, explanation ?? "Share your location to see distance.");
  }

  return (
    <span className={className} title={explanation ?? undefined}>
      Distance unavailable
    </span>
  );
}

/** Convenience: pin icon + distance, the pattern used on cards. */
export function GameDistanceChip({ game, className }: { game: GameGeo; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      <MapPin className="h-3.5 w-3.5 shrink-0 text-coral" />
      <GameDistance game={game} />
    </span>
  );
}
