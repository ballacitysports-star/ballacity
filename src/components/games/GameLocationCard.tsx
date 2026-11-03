import { Loader2, Lock, MapPin, Navigation, RefreshCw } from "lucide-react";
import { OpenInMaps } from "@/components/OpenInMaps";
import { Button } from "@/components/ui/button";
import { retryExactLocations, useExactLocationStatus } from "@/hooks/use-exact-location";
import { gameLocationView, type LocatedGame } from "@/lib/youth-game-location";
import type { ReactNode } from "react";

/**
 * The location block of the game page.
 *
 * A youth-inclusive game shows its exact venue and directions only to the people the database released it to
 * (host, confirmed players, their verified guardians, managers). Everyone else sees the neighborhood and a note,
 * with no directions link. Loading, denied and error states are explicit so a slow phone connection never shows
 * a wrong or blank place.
 */
export function GameLocationCard({
  game,
  signedIn,
  children,
}: {
  game: LocatedGame & { indoor?: boolean };
  signedIn: boolean;
  /** Extra rows under the location (for example the hosting venue). */
  children?: ReactNode;
}) {
  const status = useExactLocationStatus();
  const view = gameLocationView(game, status, signedIn);
  const address = [game.location, game.neighborhood].filter(Boolean).join(", ");
  const indoorLabel = game.indoor ? "Indoor" : "Outdoor";

  return (
    <div
      className="overflow-hidden rounded-3xl border border-border bg-surface"
      data-testid="game-location-card"
      data-precision={view.kind}
    >
      <div
        className="relative h-32"
        style={{
          background:
            "radial-gradient(50% 60% at 50% 50%, oklch(0.30 0.08 145 / 0.5), transparent 60%), linear-gradient(180deg, oklch(0.18 0.03 240), oklch(0.14 0.03 250))",
        }}
      >
        <div className="absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-lime text-primary-foreground glow-lime">
          {view.kind === "approximate" ? (
            <Lock className="h-5 w-5" />
          ) : (
            <MapPin className="h-5 w-5" />
          )}
        </div>
      </div>

      {view.kind === "exact" && (
        <OpenInMaps address={address}>
          <div className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold underline-offset-2 hover:underline">
                {game.location}
              </div>
              <div className="text-sm text-muted-foreground">
                {game.neighborhood} · {indoorLabel}
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-lime/15 px-3 py-1 text-xs font-semibold text-lime">
              <Navigation className="h-3.5 w-3.5" /> Directions
            </span>
          </div>
        </OpenInMaps>
      )}

      {view.kind === "loading" && (
        <div className="flex items-center gap-3 p-4" role="status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          <div className="text-sm text-muted-foreground">
            Checking your access to the exact location…
          </div>
        </div>
      )}

      {view.kind === "approximate" && (
        <div className="p-4">
          <div className="font-semibold">{game.location}</div>
          <div className="text-sm text-muted-foreground">
            {game.neighborhood && game.neighborhood !== game.location
              ? `${game.neighborhood} · `
              : ""}
            {indoorLabel}
          </div>
          <p className="mt-2 text-xs text-muted-foreground" role="note">
            {view.note}
          </p>
        </div>
      )}

      {view.kind === "error" && (
        <div className="flex flex-wrap items-center gap-3 p-4" role="alert">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{game.location}</div>
            <p className="text-xs text-muted-foreground">{view.note}</p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => retryExactLocations()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Try again
          </Button>
        </div>
      )}
      {children}
    </div>
  );
}
