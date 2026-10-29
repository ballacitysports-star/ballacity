import { Link } from "@tanstack/react-router";
import { ArrowRight, Calendar, MapPin } from "lucide-react";
import type { CityGameRow } from "@/lib/city-seo";
import { formatWhen } from "@/lib/format";
import { SPORT_GUIDES } from "@/lib/sports-guide";

/** Shared card surface for the public listings (games, teams, venues). */
export const publicCardClass =
  "block rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-lime/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function emojiFor(sport: string) {
  return SPORT_GUIDES.find((g) => g.sport.toLowerCase() === sport.toLowerCase())?.emoji ?? "🏅";
}

export function PublicGameRow({ g }: { g: CityGameRow }) {
  return (
    <Link to="/games/$gameId" params={{ gameId: g.id }} className={publicCardClass}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-background text-2xl"
        >
          {emojiFor(g.sport)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold">{g.title}</p>
          <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" aria-hidden /> {formatWhen(g.date)}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {[g.location, g.neighborhood].filter(Boolean).join(" · ")}
            </span>
          </p>
        </div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
        <span className="rounded-full bg-background px-2.5 py-1">{g.sport}</span>
        {g.skill && <span className="rounded-full bg-background px-2.5 py-1">{g.skill}</span>}
        <span className="rounded-full bg-background px-2.5 py-1 text-lime">
          {g.price ? `$${g.price}` : "Free"}
        </span>
      </div>
    </Link>
  );
}
