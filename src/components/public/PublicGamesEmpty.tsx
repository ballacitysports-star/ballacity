import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

const primary =
  "inline-flex min-h-11 items-center gap-2 rounded-full bg-lime-gradient px-5 text-sm font-bold text-primary-foreground";
const secondary =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-5 text-sm font-semibold";

/**
 * Shown when a public city has no eligible games. It says only what is true (nothing is
 * listed), and gives a signed-out visitor who wants to play something to do besides
 * hosting: widen the sport filter, try another city, or make an account. Nothing here
 * implies games exist or that anyone will be notified.
 */
export function PublicGamesEmpty({
  cityName,
  sport,
  next,
  onShowAllSports,
  onPickCity,
}: {
  cityName: string;
  /** The active sport filter, if any. */
  sport?: string;
  /** Where to come back to after signing up. */
  next: string;
  onShowAllSports: () => void;
  onPickCity: () => void;
}) {
  return (
    <div
      className="mt-3 rounded-2xl border border-border bg-surface p-6 text-center"
      data-testid="public-games-empty"
    >
      <p className="font-semibold">
        {sport
          ? `No public ${sport.toLowerCase()} games listed yet.`
          : "No public games listed yet."}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Nothing is listed in {cityName} right now. You can look elsewhere or start one yourself.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {sport ? (
          <button type="button" onClick={onShowAllSports} className={primary}>
            Show all sports
          </button>
        ) : (
          <button type="button" onClick={onPickCity} className={primary}>
            Try another city
          </button>
        )}
        {sport ? (
          <button type="button" onClick={onPickCity} className={secondary}>
            Try another city
          </button>
        ) : null}
        <Link to="/auth" search={{ mode: "signup", next }} className={secondary}>
          Create a free account
        </Link>
        <Link to="/create" className={secondary}>
          Host a game <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
