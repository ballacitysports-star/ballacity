import { CalendarClock, Lock, MapPin, Tag } from "lucide-react";
import { PublicPreviewFrame } from "@/components/public/PublicPreviewFrame";
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
    <PublicPreviewFrame
      next={next}
      ctaLabel={open ? "Create a free account to join" : "Create a free account"}
    >
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
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{open.description}</p>
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
    </PublicPreviewFrame>
  );
}
