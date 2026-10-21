import { Link } from "@tanstack/react-router";
import { CalendarClock, Lock, MapPin, Tag } from "lucide-react";
import { Logo } from "@/components/Logo";
import { formatGameWhen } from "@/lib/format";
import { SPORTS } from "@/lib/sample-data";
import type { PublicGameSeo } from "@/lib/city-pages.functions";

/**
 * What a signed-out visitor sees at /games/<id>: the same few public facts that
 * feed the page's link preview, and nothing more. No roster, host, chat or
 * payment details. A game that is private, for under-18s, cancelled, over, or
 * not found gets one generic prompt, so the page never says which of those it is.
 */
export function PublicGamePreview({ seo, next }: { seo: PublicGameSeo | null; next: string }) {
  const open = seo?.indexable === true ? seo : null;
  const sport = open ? SPORTS.find((s) => s.name === open.sport) : undefined;

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="page-shell-narrow flex items-center justify-between py-3">
          <Logo />
          <Link
            to="/auth"
            search={{ next }}
            className="rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-semibold text-foreground transition-colors hover:border-lime/50 hover:text-lime"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="page-shell-narrow space-y-6 py-8">
        {open ? (
          <section className="space-y-4">
            <p className="page-eyebrow">
              {sport ? <span aria-hidden>{sport.emoji} </span> : null}
              {open.sport}
            </p>
            <h1 className="page-title">{open.title}</h1>
            <ul className="space-y-3 rounded-2xl border border-border bg-surface p-4 text-sm">
              <li className="flex items-start gap-2">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-lime" aria-hidden />
                <span>{formatGameWhen({ date: open.date, allDay: open.allDay })}</span>
              </li>
              {open.location || open.neighborhood ? (
                <li className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-lime" aria-hidden />
                  <span className="min-w-0 break-words">
                    {[open.location, open.neighborhood].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ) : null}
              <li className="flex items-start gap-2">
                <Tag className="mt-0.5 h-4 w-4 shrink-0 text-lime" aria-hidden />
                <span>{open.price > 0 ? `$${open.price.toFixed(2)} to play` : "Free to play"}</span>
              </li>
            </ul>
            {open.description ? (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {open.description}
              </p>
            ) : null}
          </section>
        ) : (
          <section className="space-y-2 rounded-2xl border border-border bg-surface p-6 text-center">
            <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
            <h1 className="page-title">This game is for BallaCity members</h1>
            <p className="page-subtitle mx-auto">
              Sign in or create a free account to see the details.
            </p>
          </section>
        )}

        <div className="space-y-3">
          <Link
            to="/auth"
            search={{ next, mode: "signup" }}
            className="flex w-full items-center justify-center rounded-2xl bg-lime-gradient py-3 text-sm font-bold text-primary-foreground glow-lime"
          >
            {open ? "Create a free account to join" : "Create a free account"}
          </Link>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/auth" search={{ next }} className="font-semibold text-lime underline">
              Sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
