import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { BAND_COPY, TEEN_RESTRICTION, type PrivacyBand } from "@/lib/teen-reel-privacy";

/**
 * Who can watch a reel, by age, in plain language. The same words as the panel on the
 * Reels page (both read BAND_COPY). The rules themselves are enforced in the database.
 */
export const Route = createFileRoute("/reel-privacy")({
  head: () =>
    pageHead({
      path: "/reel-privacy",
      title: "Reel privacy — ballaCity",
      description: "Who can watch a reel on ballaCity, by age, and how parents and guardians stay in control.",
    }),
  component: ReelPrivacyPage,
});

const ORDER: PrivacyBand[] = ["under_13", "teen_13_15", "teen_16_17", "adult"];

function ReelPrivacyPage() {
  return (
    <main className="page-shell-prose pb-24 pt-6">
      <div className="flex items-center gap-2 text-primary">
        <ShieldCheck className="h-5 w-5" aria-hidden />
        <span className="section-eyebrow">Reel privacy</span>
      </div>
      <h1 className="mt-2 page-title">Who can watch your reels</h1>
      <p className="mt-2 page-subtitle">
        What you can share depends on your age. These rules are enforced by the app itself, not just
        shown on screen, and they only ever get stricter for younger players.
      </p>

      <div className="mt-6 space-y-4">
        {ORDER.map((b) => {
          const c = BAND_COPY[b];
          return (
            <section key={b} className="rounded-2xl border border-border bg-surface p-4" aria-label={c.ageLabel}>
              <h2 className="font-display text-sm font-bold">{c.ageLabel}</h2>
              <p className="mt-1 text-sm font-semibold text-lime">{c.summary}</p>
              <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Who can watch</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {c.audiences.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              {c.never.length > 0 && (
                <>
                  <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Never</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {c.never.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </>
              )}
              {b === "teen_13_15" && <p className="mt-3 text-xs text-muted-foreground">{TEEN_RESTRICTION}</p>}
            </section>
          );
        })}
      </div>

      <section className="mt-8 space-y-3 text-sm">
        <h2 className="font-display text-base font-bold">How guardians stay in control</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            For players aged 13 to 15, every reel starts as <strong>Guardian only</strong>. A verified parent or
            guardian can watch it, approve <strong>one team</strong> for it, take that approval back, or delete the reel,
            at any time, from the Parent Center.
          </li>
          <li>The player cannot make a reel more visible. They can only make it more private.</li>
          <li>
            Approval is checked every time someone opens the reel. If the guardian link ends, the player leaves the
            team, or the viewer leaves the team, access stops straight away.
          </li>
          <li>For players under 13, a parent adds clips to their own reels, and they are never public.</li>
          <li>
            Players aged 16 and 17 are never public. They can let followers they have approved watch. An adult
            follower also has to share a team with them, and their parent or guardian can always watch.
          </li>
        </ul>

        <h2 className="pt-3 font-display text-base font-bold">Moderation and safety</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Every reel still goes through our safety checks. A reel on a safety hold is hidden from everyone except
            our reviewers, including approved teams, until it is cleared.
          </li>
          <li>Under-13s and accounts with locked child features are never shown to anyone outside the family.</li>
          <li>Reels are never indexed by search engines for players under 18, and never appear in public search.</li>
        </ul>

        <p className="pt-2 text-xs text-muted-foreground">
          Questions or something that looks wrong? Use the report option on any reel, or contact us from the Help page.{" "}
          <Link to="/parent" className="font-semibold text-primary underline">
            Parent Center
          </Link>
        </p>
      </section>
    </main>
  );
}
