import { ShieldCheck } from "lucide-react";
import { useHostAttendanceStats } from "@/lib/game-lifecycle";
import { isUuid } from "@/lib/game-flow-status";
import { reliabilityPercent, usePlayerActivityStats } from "@/lib/player-stats";
import type { RevieweeKind } from "@/lib/reviews";

/**
 * What the app measures itself, shown next to what people say. Showing up and
 * cancelling are facts from attendance records, so reviews never need to ask
 * about them. Nothing renders until there is something real to report.
 */
export function MeasuredStats({
  revieweeId,
  kind,
}: {
  revieweeId: string | undefined;
  kind: RevieweeKind;
}) {
  const real = isUuid(revieweeId);
  const player = usePlayerActivityStats(kind === "player" && real ? revieweeId : undefined).data;
  const host = useHostAttendanceStats(kind === "host" && real ? revieweeId : undefined);

  const facts: string[] = [];
  if (kind === "player" && player) {
    // reliabilityPercent reports 100 when nothing has been marked yet; only
    // show it once at least one game has actually been marked.
    if (player.gamesAttended + player.noShows > 0) {
      facts.push(
        `Shows up ${reliabilityPercent(player)}% of the time · ${player.gamesAttended} game${
          player.gamesAttended === 1 ? "" : "s"
        } played`,
      );
    }
    if (player.hostedCompleted > 0) {
      facts.push(
        `Has hosted ${player.hostedCompleted} game${player.hostedCompleted === 1 ? "" : "s"}`,
      );
    }
  }
  if (kind === "host" && host && host.completedGames + host.cancelledGames > 0) {
    facts.push(
      `Ran ${host.completedGames} game${host.completedGames === 1 ? "" : "s"}` +
        (host.cancelledGames > 0 ? ` · cancelled ${host.cancelledGames}` : " · none cancelled"),
    );
  }

  if (facts.length === 0) return null;
  return (
    <div
      className="mt-3 rounded-2xl border border-border bg-surface p-3"
      data-testid="measured-stats"
    >
      <div className="flex items-center gap-1.5 micro-label text-muted-foreground">
        <ShieldCheck className="h-3 w-3" /> Tracked automatically
      </div>
      <ul className="mt-1 space-y-0.5 text-xs font-semibold">
        {facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  );
}
