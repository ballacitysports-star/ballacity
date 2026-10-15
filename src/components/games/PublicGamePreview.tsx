import { Link } from "@tanstack/react-router";
import { CalendarClock, MapPin, Tag } from "lucide-react";
import { Logo } from "@/components/Logo";
import type { PublicGameSeo } from "@/lib/city-pages.functions";
import { formatGameWhen } from "@/lib/format";
import { authSearchHere } from "@/lib/pending-next";

/**
 * What a signed-out visitor sees at a shared game link. It shows only what
 * `getPublicGameSeo` already releases for adult, public, upcoming games, and
 * never the exact venue, host or roster. Only games the host limited to 18+ qualify.
 * Anything that server call does not mark `indexable` and `adultsOnly` (private,
 * youth, open-age, cancelled, past, unknown) gets a generic
 * sign-in prompt that reveals nothing about the game.
 */
export function PublicGamePreview({ seo }: { seo: PublicGameSeo | null }) {
  const search = authSearchHere() as never;
  const shown = seo?.indexable && seo.adultsOnly ? seo : null;

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-md items-center justify-between px-5 py-3">
          <Logo />
        </div>
      </header>
      <main className="mx-auto max-w-md px-5 py-8">
        {shown ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {shown.sport} game
            </p>
            <h1 className="page-title mt-1">{shown.title}</h1>
            <ul className="mt-5 space-y-3 text-sm">
              <li className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
                {formatGameWhen({ date: shown.date })}
              </li>
              {shown.neighborhood && (
                <li className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {shown.neighborhood}
                </li>
              )}
              <li className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-muted-foreground" aria-hidden />
                {shown.price ? `$${shown.price}` : "Free"}
              </li>
            </ul>
            {shown.description && (
              <p className="mt-5 text-sm text-muted-foreground">{shown.description}</p>
            )}
            <p className="mt-6 text-xs text-muted-foreground">
              Create a free account to see the exact spot, who&rsquo;s playing, and request to join.
            </p>
          </>
        ) : (
          <>
            <h1 className="page-title">Sign in to see this game</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This game isn&rsquo;t open to the public. Sign in to check whether you can view it.
            </p>
          </>
        )}
        <div className="mt-6 flex flex-col gap-2">
          <Link
            to="/auth"
            search={search}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-lime px-5 text-sm font-bold text-primary-foreground"
          >
            {shown ? "Sign up to join" : "Sign in"}
          </Link>
          {shown && (
            <Link
              to="/auth"
              search={search}
              className="inline-flex min-h-11 items-center justify-center text-sm text-muted-foreground"
            >
              Already have an account? Sign in
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
