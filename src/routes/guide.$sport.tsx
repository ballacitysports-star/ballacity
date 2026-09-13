import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { BackHeader } from "@/components/layout/BackHeader";
import { PolicyLinks } from "@/components/PolicyLinks";
import { pageHead, SITE_URL } from "@/lib/seo";
import { guideBySlug } from "@/lib/sports-guide";

export const Route = createFileRoute("/guide/$sport")({
  loader: ({ params }) => {
    const guide = guideBySlug(params.sport);
    if (!guide) throw notFound();
    return { guide };
  },
  head: ({ params, loaderData }) => {
    if (!loaderData) {
      return pageHead({
        title: "Sport guide not found — ballaCity",
        description: "This sports guide isn't available.",
        noindex: true,
      });
    }
    const { guide } = loaderData;
    return pageHead({
      path: `/guide/${guide.slug}`,
      ogType: "article",
      title: `${guide.sport} pickup guide — how to play and join games | ballaCity`,
      description: `How pickup ${guide.sport.toLowerCase()} works: ${guide.groupSize}, typical session length, gear to bring, common positions, etiquette, and how to find a ${guide.sport.toLowerCase()} game near you.`,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: `${guide.sport} pickup guide`,
        description: guide.tagline,
        mainEntityOfPage: `${SITE_URL}/guide/${params.sport}`,
        publisher: { "@type": "Organization", name: "ballaCity" },
      },
    });
  },
  notFoundComponent: () => (
    <div className="min-h-dvh bg-background">
      <BackHeader title="Sports Guide" fallbackTo="/guide" />
      <main className="page-shell-prose py-10">
        <h1 className="page-title">Guide not found</h1>
        <p className="mt-2 page-subtitle">We don't have a guide for that sport yet.</p>
        <Link
          to="/guide"
          className="mt-5 inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold"
        >
          All sports
        </Link>
      </main>
    </div>
  ),
  component: SportGuidePage,
});

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="mt-6">
      <h2 className="section-eyebrow">{title}</h2>
      <ul className="mt-2 grid gap-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm leading-relaxed">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SportGuidePage() {
  const { guide } = Route.useLoaderData();

  return (
    <div className="min-h-dvh bg-background">
      <BackHeader title={`${guide.sport} guide`} fallbackTo="/guide" />

      <main className="page-shell-prose py-6 pb-28">
        <img
          src={guide.cover}
          alt={`People playing ${guide.sport.toLowerCase()}`}
          loading="lazy"
          className="h-40 w-full rounded-2xl object-cover"
        />

        <h1 className="mt-4 page-title">{guide.sport}</h1>

        <p className="mt-2 page-subtitle">{guide.tagline}</p>

        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border bg-surface px-4 py-3">
            <dt className="section-eyebrow">Group size</dt>
            <dd className="mt-1 text-sm font-semibold">{guide.groupSize}</dd>
          </div>
          <div className="rounded-2xl border border-border bg-surface px-4 py-3">
            <dt className="section-eyebrow">Session length</dt>
            <dd className="mt-1 text-sm font-semibold">{guide.sessionLength}</dd>
          </div>
        </dl>

        <List title="How a pickup game runs" items={guide.howItWorks} />
        <List title="What to bring" items={guide.bring} />

        <section className="mt-6">
          <h2 className="section-eyebrow">Positions and roles</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {guide.positions.map((p) => (
              <li
                key={p}
                className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold"
              >
                {p}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">
            These are the same positions you can add to your profile, so hosts can see where you
            like to play.
          </p>
        </section>

        <List title="Etiquette" items={guide.etiquette} />

        <section className="mt-6">
          <h2 className="section-eyebrow">Skill levels</h2>
          <p className="mt-2 text-sm leading-relaxed">{guide.skillNotes}</p>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-surface px-4 py-4">
          <h2 className="text-sm font-bold">Get started on ballaCity</h2>
          <div className="mt-3 grid gap-2">
            <Link
              to="/feed"
              search={{ sport: guide.sport }}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-lime px-4 text-sm font-bold text-primary-foreground"
            >
              Find {guide.sport.toLowerCase()} near you
            </Link>
            <Link
              to="/create"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-border px-4 text-sm font-semibold"
            >
              Host your own game
            </Link>
            <Link
              to="/players"
              search={{ sport: guide.sport }}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-border px-4 text-sm font-semibold"
            >
              Find players
            </Link>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Joined a game? Message the host with any questions before you show up.
          </p>
        </section>

        <section className="mt-6">
          <h2 className="section-eyebrow">Before you play</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Hosts organize games — ballaCity doesn't supervise them, referee, or inspect venues.
            Warm up, play within your ability, and stop if you're hurt.
          </p>
          <PolicyLinks className="mt-3" />
        </section>

        <Link
          to="/guide"
          className="mt-8 inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold"
        >
          All sports guides
        </Link>
      </main>
    </div>
  );
}
