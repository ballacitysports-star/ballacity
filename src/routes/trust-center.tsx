import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bot,
  CreditCard,
  Gavel,
  Lock,
  ShieldCheck,
  Trash2,
  UserCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PolicyLinks } from "@/components/PolicyLinks";
import { pageHead } from "@/lib/seo";
import { SITE_URL } from "@/lib/seo";
import { TRUST_TOPICS } from "@/lib/trust";

const ICONS: Record<string, LucideIcon> = {
  privacy: Lock,
  security: ShieldCheck,
  "user-safety": UserCheck,
  payments: CreditCard,
  ai: Bot,
  "account-deletion": Trash2,
  moderation: Gavel,
};

export const Route = createFileRoute("/trust-center")({
  head: () =>
    pageHead({
      path: "/trust-center",
      title: "Trust Center — ballaCity",
      description:
        "How ballaCity handles privacy, account security, reporting and blocking, direct player-to-player payments, AI highlight analysis, account deletion, and moderation.",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "ballaCity Trust Center",
        url: `${SITE_URL}/trust-center`,
        description:
          "Plain-language explanations of privacy, security, safety, payments, AI, account deletion, and moderation on ballaCity.",
      },
    }),
  component: TrustCenter,
});

function TrustCenter() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-2 py-2.5 backdrop-blur">
        <Link to="/" className="rounded-full p-2 hover:bg-surface" aria-label="Back to home">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <span className="text-sm font-medium">Trust Center</span>
      </header>

      <main className="page-shell-prose py-6 pb-28">
        <h1 className="page-title">Trust Center</h1>
        <p className="mt-2 page-subtitle">
          Straight answers about how ballaCity works: what we do with your information, how accounts
          are protected, what happens when you report someone, and where money actually goes. This
          page describes how the product behaves today — it isn't a certification or an audit
          result.
        </p>

        {/* On-page nav */}
        <nav aria-label="Trust Center sections" className="mt-5 flex flex-wrap gap-2">
          {TRUST_TOPICS.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              className="rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              {t.title}
            </a>
          ))}
        </nav>

        <div className="mt-6 space-y-4">
          {TRUST_TOPICS.map((t) => {
            const Icon = ICONS[t.id] ?? ShieldCheck;
            return (
              <section
                key={t.id}
                id={t.id}
                className="scroll-mt-16 rounded-2xl border border-border bg-surface px-4 py-4"
              >
                <h2 className="flex items-center gap-2 text-sm font-bold">
                  <Icon className="h-4 w-4 text-lime" aria-hidden />
                  {t.title}
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed">{t.summary}</p>
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
            );
          })}
        </div>

        <section className="mt-6 rounded-2xl border border-border bg-surface px-4 py-4">
          <h2 className="text-sm font-bold">More</h2>
          <PolicyLinks className="mt-3" />
        </section>
      </main>
    </div>
  );
}
