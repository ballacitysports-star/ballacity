import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PolicyLinks } from "@/components/PolicyLinks";
import { LegalSections } from "@/components/legal/LegalDocumentBody";
import { livePublishedVersion } from "@/lib/legal-documents";
import { loadPublishedLegalDocuments } from "@/lib/legal-documents.functions";
import { pageHead } from "@/lib/seo";
import { COMMUNITY_GUIDELINES, GUIDELINES_ENFORCEMENT } from "@/lib/trust";

export const Route = createFileRoute("/community-guidelines")({
  head: () =>
    pageHead({
      path: "/community-guidelines",
      title: "Community Guidelines | BallaCity",
      description:
        "The rules for playing on BallaCity: respect other players, post accurate games, play safely, keep payments clean, and upload only clips you own.",
    }),
  loader: loadPublishedLegalDocuments,
  component: GuidelinesPage,
});

function GuidelinesPage() {
  const { published } = Route.useLoaderData();
  // A version an admin published takes over from the bundled rules below.
  const live = livePublishedVersion("community_guidelines", published);
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-2 py-2.5 backdrop-blur">
        <Link to="/" className="rounded-full p-2 hover:bg-surface" aria-label="Back to home">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <span className="text-sm font-medium">Community Guidelines</span>
      </header>

      <main className="page-shell-prose py-6 pb-28">
        <h1 className="page-title">Community Guidelines</h1>
        <p className="mt-2 page-subtitle">
          BallaCity works when runs are honest, safe, and worth showing up for. These are the
          expectations for every player, host, team, gym, and trainer on the app.
        </p>

        {live ? (
          <article className="mt-6 space-y-5">
            <p className="text-xs text-muted-foreground">
              Version {live.version} · Effective {live.effectiveDate}
            </p>
            <LegalSections sections={live.sections} />
            <PolicyLinks />
          </article>
        ) : (
          <BundledGuidelines />
        )}
      </main>
    </div>
  );
}

function BundledGuidelines() {
  return (
    <>
      <div className="mt-6 space-y-4">
        {COMMUNITY_GUIDELINES.map((rule) => (
          <section key={rule.id} className="rounded-2xl border border-border bg-surface px-4 py-4">
            <h2 className="text-sm font-bold">{rule.title}</h2>
            <ul className="mt-2 space-y-1.5">
              {rule.points.map((p) => (
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

      <section className="mt-5 rounded-2xl border border-border bg-surface px-4 py-4">
        <h2 className="text-sm font-bold">What happens if you break them</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {GUIDELINES_ENFORCEMENT}
        </p>
        <PolicyLinks className="mt-3" />
      </section>
    </>
  );
}
