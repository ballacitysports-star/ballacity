import { createFileRoute, Link } from "@tanstack/react-router";
import { BackHeader } from "@/components/layout/BackHeader";
import { PolicyLinks } from "@/components/PolicyLinks";
import { pageHead, SITE_URL } from "@/lib/seo";
import { guideBySlug } from "@/lib/sports-guide";

const PATH = "/blog/how-to-find-pickup-soccer-games";
const TITLE = "How to Find Pickup Soccer Games Near You | BallaCity";
const DESCRIPTION =
  "Want to play soccer this week? Here's how to find local pickup soccer games — apps, parks, leagues and community groups — plus what to bring and how to join your first match.";

export const Route = createFileRoute("/blog/how-to-find-pickup-soccer-games")({
  head: () =>
    pageHead({
      path: PATH,
      ogType: "article",
      title: TITLE,
      description: DESCRIPTION,
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "How to find pickup soccer games near you",
          description: DESCRIPTION,
          mainEntityOfPage: `${SITE_URL}${PATH}`,
          publisher: { "@type": "Organization", name: "BallaCity" },
        },
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: "Where can I play soccer near me?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Most pickup soccer happens on public park fields, school and college fields outside of team hours, indoor futsal courts and turf complexes that rent open-play slots. Searching a pickup app by location is usually faster than checking each venue, because hosts post the exact field, time and how many spots are left.",
              },
            },
            {
              "@type": "Question",
              name: "Do I need a team to play pickup soccer?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "No. Pickup games are built for individuals. Hosts split whoever shows up into sides, so you can join alone and still play a full session.",
              },
            },
            {
              "@type": "Question",
              name: "How much does pickup soccer cost?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Park games are often free. Indoor or turf sessions usually charge a per-player fee to cover the field rental, and the host sets that amount when the game is posted.",
              },
            },
          ],
        },
      ],
    }),
  component: Article,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-bold">{title}</h2>
      <div className="mt-2 grid gap-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function Article() {
  const soccer = guideBySlug("soccer");

  return (
    <div className="min-h-dvh bg-background">
      <BackHeader title="Pickup soccer" fallbackTo="/guide" />

      <main className="page-shell-prose py-6 pb-28">
        {soccer ? (
          <img
            src={soccer.cover}
            alt="Players in a pickup soccer game on an outdoor field"
            loading="lazy"
            className="h-40 w-full rounded-2xl object-cover"
          />
        ) : null}

        <h1 className="mt-4 page-title">How to find pickup soccer games near you</h1>
        <p className="mt-2 page-subtitle">
          If you want to play soccer this week and don't have a team, pickup is the answer. This
          guide covers where local games actually happen, how to find one you can join today, and
          what to expect when you show up.
        </p>

        <Section title="What counts as a pickup soccer game">
          <p>
            A pickup game is an open session with no roster and no season. A host books or claims a
            field, sets a time and a format — usually small-sided, 5v5 to 7v7 — and whoever signs up
            gets split into even sides on the spot. You can come alone, play for an hour or two, and
            leave without committing to anything else.
          </p>
        </Section>

        <Section title="Where local games happen">
          <ul className="grid gap-2">
            <li>
              <strong className="text-foreground">Public park fields.</strong> Usually free, busiest
              on weekday evenings and weekend mornings. Formats vary with whoever turns up.
            </li>
            <li>
              <strong className="text-foreground">Indoor futsal and turf complexes.</strong> Fixed
              start times, guaranteed surface, and a per-player fee that covers the rental. Best
              option in winter or bad weather.
            </li>
            <li>
              <strong className="text-foreground">School and college fields.</strong> Often open
              outside team practice hours. Check posted rules before playing.
            </li>
            <li>
              <strong className="text-foreground">Community and rec-league drop-ins.</strong> Some
              leagues run open sessions between seasons for players without a team.
            </li>
          </ul>
        </Section>

        <Section title="How people find games — and what actually works">
          <ul className="grid gap-2">
            <li>
              <strong className="text-foreground">Just showing up at a field.</strong> Sometimes
              works, often doesn't. You can't tell in advance whether a game is on, whether sides
              are full, or what skill level to expect.
            </li>
            <li>
              <strong className="text-foreground">Social media groups and group chats.</strong>{" "}
              Games get buried between other posts, details change in replies, and you need an
              invite to the right group before you see anything.
            </li>
            <li>
              <strong className="text-foreground">Flyers and notice boards.</strong> Rarely current,
              and there's no way to confirm a spot before travelling.
            </li>
            <li>
              <strong className="text-foreground">A pickup app.</strong> Games are listed by
              location, date and skill level, with the field, the format, the fee and the number of
              spots left visible before you commit — and a way to message the host if something is
              unclear.
            </li>
          </ul>
        </Section>

        <Section title="Finding a soccer game on BallaCity">
          <ol className="grid gap-2">
            <li>
              1. Open the games near you and filter to soccer. You'll see the date, time, venue and
              remaining spots for each session.
            </li>
            <li>
              2. Check the skill level and format so the game matches how you want to play — casual
              kickabout or competitive small-sided.
            </li>
            <li>3. Request your spot. Some hosts approve requests; some accept anyone.</li>
            <li>
              4. Message the host with anything you need to know — parking, gate codes, bib colours.
            </li>
            <li>5. No game near you at a time that works? Post your own and let players join.</li>
          </ol>
        </Section>

        <Section title="What to bring to your first game">
          <ul className="grid gap-2">
            {(soccer?.bring ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Section>

        <Section title="Etiquette that gets you invited back">
          <ul className="grid gap-2">
            {(soccer?.etiquette ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Section>

        <Section title="Common questions">
          <p>
            <strong className="text-foreground">Do I need a team?</strong> No — pickup is built for
            individuals, and hosts balance the sides from whoever shows up.
          </p>
          <p>
            <strong className="text-foreground">What does it cost?</strong> Park games are often
            free. Indoor and turf sessions charge a per-player fee set by the host to cover the
            field.
          </p>
          <p>
            <strong className="text-foreground">I'm out of practice.</strong> Pick a session marked
            casual or beginner-friendly, say so when you arrive, and play within your ability.
          </p>
        </Section>

        <section className="mt-8 rounded-2xl border border-border bg-surface px-4 py-4">
          <h2 className="text-sm font-bold">Play soccer this week</h2>
          <div className="mt-3 grid gap-2">
            <Link
              to="/feed"
              search={{ sport: "Soccer" }}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-lime px-4 text-sm font-bold text-primary-foreground"
            >
              Find soccer games near you
            </Link>
            <Link
              to="/create"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-border px-4 text-sm font-semibold"
            >
              Host a soccer game
            </Link>
            <Link
              to="/guide/$sport"
              params={{ sport: "soccer" }}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-border px-4 text-sm font-semibold"
            >
              Read the full soccer guide
            </Link>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="section-eyebrow">Before you play</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Hosts organize games — BallaCity doesn't supervise them, referee, or inspect venues.
            Warm up, play within your ability, and stop if you're hurt.
          </p>
          <PolicyLinks className="mt-3" />
        </section>
      </main>
    </div>
  );
}
