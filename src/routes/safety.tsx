import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Flag, Heart, ShieldAlert, ShieldCheck } from "lucide-react";
import { BackHeader } from "@/components/layout/BackHeader";
import { PolicyLinks } from "@/components/PolicyLinks";
import { pageHead } from "@/lib/seo";
import {
  EMERGENCY_NOTICE,
  HOST_RESPONSIBILITY,
  LEGAL_REVIEW_LABEL,
  RISK_ACKNOWLEDGMENT,
  SAFETY_TOPICS,
  STAY_SAFE_POINTS,
} from "@/lib/safety";

export const Route = createFileRoute("/safety")({
  head: () =>
    pageHead({
      path: "/safety",
      title: "BallaCity Safety & Community Guidelines",
      description:
        "How to stay safe on ballaCity: sports safety, meeting new players, game and payment safety, messaging, reporting, blocking, and emergency information.",
    }),
  component: SafetyCenter,
});

function SafetyCenter() {
  return (
    <div className="min-h-dvh bg-background">
      <BackHeader title="Safety Center" />

      <main className="page-shell-prose py-6 pb-28">
        <h1 className="page-title">Safety Center</h1>
        <p className="mt-2 page-subtitle">
          ballaCity helps players find games — hosts organize them. ballaCity does not supervise
          games, inspect venues, referee play, or guarantee anyone's safety. These are the habits
          that keep pickup sports safe.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link
            to="/safety/children"
            className="rounded-full border border-border px-3 py-1.5 font-semibold"
          >
            Child &amp; teen safety
          </Link>
          <Link
            to="/parent"
            className="rounded-full border border-border px-3 py-1.5 font-semibold"
          >
            Parent Center
          </Link>
        </div>

        {/* Emergency */}
        <section className="mt-5 rounded-2xl border border-destructive/50 bg-destructive/5 px-4 py-4">
          <div className="flex items-center gap-2 text-sm font-bold text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Emergencies
          </div>
          <p className="mt-2 text-xs leading-relaxed">{EMERGENCY_NOTICE}</p>
        </section>

        {/* Acknowledgments */}
        <section className="mt-5 space-y-3">
          <AckCard
            icon={<ShieldAlert className="h-4 w-4 text-lime" aria-hidden />}
            title="What players acknowledge when joining"
            text={RISK_ACKNOWLEDGMENT.text}
            points={RISK_ACKNOWLEDGMENT.points}
          />
          <AckCard
            icon={<ShieldCheck className="h-4 w-4 text-lime" aria-hidden />}
            title={HOST_RESPONSIBILITY.title}
            text={HOST_RESPONSIBILITY.text}
            points={HOST_RESPONSIBILITY.points}
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="mr-1 rounded bg-secondary px-1.5 py-0.5 micro-label">
              {LEGAL_REVIEW_LABEL}
            </span>
            These acknowledgments are placeholder drafts and are not a waiver or release of
            liability.
          </p>
        </section>

        {/* Stay safe */}
        <section className="mt-5 rounded-2xl border border-border bg-surface px-4 py-4">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Heart className="h-4 w-4 text-lime" aria-hidden />
            Stay safe
          </h2>
          <ul className="mt-2 space-y-1.5">
            {STAY_SAFE_POINTS.map((p) => (
              <li key={p} className="flex gap-2 text-[13px] leading-relaxed text-muted-foreground">
                <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
                {p}
              </li>
            ))}
          </ul>
        </section>

        {/* Section nav */}
        <nav aria-label="Safety Center sections" className="mt-5 flex flex-wrap gap-2">
          {SAFETY_TOPICS.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              className="rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              {t.title}
            </a>
          ))}
        </nav>

        {/* Topics */}
        <div className="mt-6 space-y-4">
          {SAFETY_TOPICS.map((t) => (
            <section
              key={t.id}
              id={t.id}
              className="scroll-mt-16 rounded-2xl border border-border bg-surface px-4 py-4"
            >
              <h2 className="text-sm font-bold">{t.title}</h2>
              <ul className="mt-2 space-y-1.5">
                {t.points.map((p) => (
                  <li
                    key={p}
                    className="flex gap-2 text-[13px] leading-relaxed text-muted-foreground"
                  >
                    <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
                    {p}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Actions */}
        <section className="mt-6 rounded-2xl border border-border bg-surface px-4 py-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Flag className="h-4 w-4 text-lime" aria-hidden />
            Report or block someone
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Use the flag icon on any profile, game, message, or highlight. Safety reports go to
            ballaCity moderators.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to="/account/blocked"
              className="rounded-full border border-border px-3 py-2 text-xs font-semibold hover:bg-background"
            >
              Blocked accounts
            </Link>
            <Link
              to="/account/privacy"
              className="rounded-full border border-border px-3 py-2 text-xs font-semibold hover:bg-background"
            >
              Privacy settings
            </Link>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-border bg-surface px-4 py-4">
          <h2 className="text-sm font-bold">More</h2>
          <PolicyLinks className="mt-3" />
        </section>
      </main>
    </div>
  );
}

function AckCard({
  icon,
  title,
  text,
  points,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  points: readonly string[];
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-4">
      <div className="flex items-center gap-2 text-sm font-bold">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed">{text}</p>
      <ul className="mt-2 space-y-1.5">
        {points.map((p) => (
          <li key={p} className="flex gap-2 text-[12px] leading-relaxed text-muted-foreground">
            <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
