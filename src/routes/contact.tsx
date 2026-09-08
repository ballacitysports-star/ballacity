import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Flag, Mail, MessageSquare, ShieldOff } from "lucide-react";
import { PolicyLinks } from "@/components/PolicyLinks";
import { EMERGENCY_NOTICE } from "@/lib/safety";
import { pageHead } from "@/lib/seo";
import { SUPPORT_EMAIL } from "@/lib/trust";

export const Route = createFileRoute("/contact")({
  head: () =>
    pageHead({
      path: "/contact",
      title: "Contact & Report a Problem — ballaCity",
      description:
        "Reach ballaCity support, report a player, game, message, or highlight, and find out what happens after you send a report.",
    }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-2 py-2.5 backdrop-blur">
        <Link to="/" className="rounded-full p-2 hover:bg-surface" aria-label="Back to home">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <span className="text-sm font-medium">Contact</span>
      </header>

      <main className="page-shell-prose py-6 pb-28">
        <h1 className="font-display text-2xl font-bold">Contact</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Questions about your account, a game, a payment, or something you saw on ballaCity? Start
          here.
        </p>

        <section className="mt-5 rounded-2xl border border-border bg-surface px-4 py-4">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Mail className="h-4 w-4 text-lime" aria-hidden />
            Email support
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Write to{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-semibold text-foreground underline underline-offset-2"
            >
              {SUPPORT_EMAIL}
            </a>{" "}
            with your account email and, if it's about a game, the game name and date.
          </p>
        </section>

        <section
          id="report"
          className="mt-4 scroll-mt-16 rounded-2xl border border-border bg-surface px-4 py-4"
        >
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Flag className="h-4 w-4 text-lime" aria-hidden />
            Report a problem
          </h2>
          <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
            <li className="flex gap-2">
              <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
              Use the flag icon on any profile, game, message, or highlight to report it directly —
              that gives moderators the context automatically.
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
              Include what happened, when, and where so the report can be reviewed quickly.
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
              For bugs or billing, email support with a screenshot and the page you were on.
            </li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to="/account/blocked"
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-semibold hover:bg-background"
            >
              <ShieldOff className="h-3.5 w-3.5" aria-hidden />
              Blocked users
            </Link>
            <Link
              to="/messages"
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-semibold hover:bg-background"
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              Messages
            </Link>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-destructive/50 bg-destructive/5 px-4 py-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Emergencies
          </h2>
          <p className="mt-2 text-xs leading-relaxed">{EMERGENCY_NOTICE}</p>
        </section>

        <section className="mt-4 rounded-2xl border border-border bg-surface px-4 py-4">
          <h2 className="text-sm font-bold">More</h2>
          <PolicyLinks className="mt-3" />
        </section>
      </main>
    </div>
  );
}
