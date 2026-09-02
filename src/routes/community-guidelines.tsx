import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PolicyLinks } from "@/components/PolicyLinks";
import { pageHead } from "@/lib/seo";
import { COMMUNITY_GUIDELINES, GUIDELINES_ENFORCEMENT } from "@/lib/trust";

export const Route = createFileRoute("/community-guidelines")({
  head: () =>
    pageHead({
      path: "/community-guidelines",
      title: "Community Guidelines — ballaCity",
      description:
        "The rules for playing on ballaCity: respect other players, post accurate games, play safely, keep payments clean, and upload only clips you own.",
    }),
  component: GuidelinesPage,
});

function GuidelinesPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-2 py-2.5 backdrop-blur">
        <Link to="/" className="rounded-full p-2 hover:bg-surface" aria-label="Back to home">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <span className="text-sm font-medium">Community Guidelines</span>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 pb-28">
        <h1 className="font-display text-2xl font-bold">Community Guidelines</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          ballaCity works when runs are honest, safe, and worth showing up for. These are the
          expectations for every player, host, team, gym, and trainer on the app.
        </p>

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
      </main>
    </div>
  );
}
