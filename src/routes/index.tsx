import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ogImageUrl, pageHead, SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/lib/seo";
import {
  ArrowRight,
  CalendarClock,
  ClipboardList,
  Dumbbell,
  MapPin,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import { Logo } from "@/components/Logo";
import { HERO_IMAGE } from "@/lib/sample-data";
import { useHostedGames } from "@/lib/hosted-games-store";
import { GameCard } from "@/components/GameCard";
import { AuthRedirectSkeleton } from "@/components/AuthRedirectSkeleton";
import { useAuth } from "@/hooks/use-auth";
import { readStoredSupabaseSession } from "@/lib/authgate-log";
import { readLastVisited } from "@/lib/last-visited";
import { clearStartHint, isAccountType, routeForSetup, startSetupOf } from "@/lib/account-type";
import { supabase } from "@/integrations/supabase/client";
import { hideFinishedGames } from "@/lib/game-time";
import { SPORT_GUIDES } from "@/lib/sports-guide";
import { TryoutsSection } from "@/components/tryouts/TryoutsSection";

const FAQS = [
  {
    q: "How do I find pickup games near me?",
    a: "Open ballaCity, allow location or pick your city, and browse open games by sport, skill level and distance. Tap a game to see the time, place and open spots.",
  },
  {
    q: "Do I need a team to join?",
    a: "No. Pickup games are built for individual players. Request a spot and the host balances teams when everyone arrives.",
  },
  {
    q: "Is ballaCity free?",
    a: "Yes, finding and joining games is free. Some hosts charge a small fee for court or field costs, which is shown on the game before you join.",
  },
  {
    q: "Can I host my own game?",
    a: "Yes. Set the sport, place, time and number of players, and your game appears for nearby players in about a minute.",
  },
  {
    q: "How do teams and coaches find me?",
    a: "Post your availability on the Players tab — your sport, skill level and when you're free. Teams and coaches browse available players and send invites straight to you.",
  },
  {
    q: "Is it safe for young players?",
    a: "Players under 18 need a parent or guardian, who can approve team invites and game requests from their Parent Center.",
  },
];

export const Route = createFileRoute("/")({
  head: () =>
    pageHead({
      path: "/",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      image: ogImageUrl({
        kind: "page",
        title: "Pickup games, teams & trainers near you",
        subtitle: "Find a game, grab your spot, and play today.",
        meta: ["Basketball", "Soccer", "Baseball"],
      }),
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "ballaCity",
          url: `${SITE_URL}/`,
          description: SITE_DESCRIPTION,
        },
        {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "ballaCity",
          url: `${SITE_URL}/`,
          description: SITE_DESCRIPTION,
        },
      ],
    }),

  component: Landing,
});

function Landing() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const hosted = useHostedGames();
  const hasStoredSession = typeof window !== "undefined" ? !!readStoredSupabaseSession() : false;
  // Clearing the hint below updates the user, which runs the effect again; that
  // run sees no hint and would send them on to the feed over their setup.
  const startedSetup = useRef(false);

  useEffect(() => {
    if (loading || !user || startedSetup.current) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("account_type")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const t = (data as { account_type?: string } | null)?.account_type;
      if (!isAccountType(t)) {
        router.navigate({ to: "/onboarding/account-type", replace: true });
        return;
      }
      // An email-confirmation link lands here, possibly on another device from
      // the sign-up, so a member who chose a role goes to that role's setup —
      // once — before the feed.
      const setup = startSetupOf(user);
      if (setup) {
        startedSetup.current = true;
        void clearStartHint();
        router.navigate({ ...routeForSetup(setup), replace: true } as never);
        return;
      }
      router.navigate({ to: readLastVisited() ?? "/feed", replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, router]);

  // Signed-in users (or those with a persisted session still hydrating)
  // see a skeleton instead of the marketing hero while we redirect.
  if (user || (loading && hasStoredSession)) return <AuthRedirectSkeleton />;

  // Real hosted games only — soonest first, public games (RLS already hides
  // private and moderator-hidden ones from anonymous visitors).
  const trending = hideFinishedGames(hosted.filter((g) => !g.isPrivate))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 4);

  return (
    <div className="min-h-dvh">
      {/* Top bar */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/60 border-b border-border">
        <div className="page-shell flex items-center justify-between py-3">
          <Logo />
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-muted-foreground">
            <a href="#availability" className="hover:text-foreground">
              Get found
            </a>
            <a href="#sports" className="hover:text-foreground">
              Sports
            </a>
            <a href="#trending" className="hover:text-foreground">
              Trending
            </a>
          </nav>
          <Link
            to="/feed"
            className="inline-flex items-center gap-1.5 rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground glow-lime hover:scale-[1.02] transition-transform"
          >
            Open app <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-hero">
        <div className="absolute inset-0 grid-noise opacity-30" />
        <div className="relative page-shell pt-12 pb-20 md:pt-20 md:pb-32 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h1
              style={{ "--enter-delay": "50ms" } as CSSProperties}
              className="enter-up font-display text-5xl md:text-7xl font-bold leading-[0.95] tracking-tight"
            >
              Find pickup games
              <br />
              <span className="text-lime">near you.</span>
            </h1>
            <p
              style={{ "--enter-delay": "120ms" } as CSSProperties}
              className="enter-up mt-5 max-w-md text-lg text-muted-foreground"
            >
              Join local pickup basketball, soccer, baseball, pickleball and more — or host your
              own run in about a minute.
            </p>
            <div
              style={{ "--enter-delay": "180ms" } as CSSProperties}
              className="enter-up mt-7 flex flex-wrap gap-3"
            >
              <Link
                to="/feed"
                className="inline-flex items-center gap-2 rounded-full bg-lime-gradient px-6 py-3.5 font-bold text-primary-foreground glow-lime hover:scale-[1.02] transition-transform"
              >
                Find a game near me <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/create"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-6 py-3.5 font-semibold text-foreground hover:border-lime/40"
              >
                Host a game
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Sports */}
      <section id="sports" className="page-shell py-16" aria-labelledby="sports-heading">
        <div className="mb-6">
          <h2 id="sports-heading" className="font-display text-3xl md:text-4xl font-bold">
            Pickup games for every sport
          </h2>
          <p className="text-muted-foreground mt-1">
            Pick a sport to learn how pickup games work — group sizes, gear and etiquette.
          </p>
        </div>
        <ul className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {SPORT_GUIDES.map((g, i) => (
            <li key={g.slug}>
              <Link
                to="/guide/$sport"
                params={{ sport: g.slug }}
                style={{ "--enter-delay": `${i * 40}ms` } as CSSProperties}
                className="enter-up block h-full rounded-2xl border border-border bg-surface p-4 hover:border-lime/40 transition-all hover:-translate-y-0.5"
              >
                <span aria-hidden className="block text-3xl mb-2">
                  {g.emoji}
                </span>
                <span className="font-semibold">Pickup {g.sport.toLowerCase()}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section id="how" className="page-shell py-16" aria-labelledby="how-heading">
        <h2 id="how-heading" className="font-display text-3xl md:text-4xl font-bold mb-8">
          How to join a pickup game
        </h2>
        <ol className="grid md:grid-cols-3 gap-4">
          {[
            ["Find a game nearby", "Browse open games by sport, skill level and distance on a live map."],
            ["Grab your spot", "Request to join in a tap. The host confirms and you get the details."],
            ["Show up and play", "Meet your crew at the court or field. Rate the run and play again."],
          ].map(([t, b], i) => (
            <li key={t} className="rounded-3xl border border-border bg-surface p-6">
              <span className="font-display text-2xl font-bold text-lime">{i + 1}</span>
              <h3 className="mt-2 font-display text-xl font-semibold">{t}</h3>
              <p className="text-muted-foreground mt-1.5 text-sm">{b}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Availability */}
      <section
        id="availability"
        className="page-shell py-16"
        aria-labelledby="availability-heading"
      >
        <div className="mb-8">
          <h2 id="availability-heading" className="font-display text-3xl md:text-4xl font-bold">
            List your availability — let teams find you.
          </h2>
          <p className="text-muted-foreground mt-1">
            Post when you're free to play, and teams and coaches can find you and invite you
            directly.
          </p>
        </div>
        <ol className="grid md:grid-cols-3 gap-4">
          {[
            {
              icon: CalendarClock,
              title: "Post your availability",
              body: "List your sport, skill level and when you're free to play.",
            },
            {
              icon: Search,
              title: "Teams and coaches find you",
              body: "They browse available players by sport, skill and distance.",
            },
            {
              icon: UserPlus,
              title: "Invites come to you",
              body: "Accept an invite and you're on the roster.",
            },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <li key={s.title} className="rounded-3xl border border-border bg-surface p-6">
                <div className="inline-grid h-11 w-11 place-items-center rounded-2xl mb-4 bg-lime/15 text-lime">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-display text-xl font-semibold">{s.title}</h3>
                <p className="text-muted-foreground mt-1.5 text-sm">{s.body}</p>
              </li>
            );
          })}
        </ol>
        <Link
          to="/players"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-lime-gradient px-6 py-3.5 font-bold text-primary-foreground glow-lime hover:scale-[1.02] transition-transform"
        >
          Post your availability <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      <TryoutsSection />

      {/* Teams, coaches & trainers */}
      <section id="for-teams" className="page-shell py-16" aria-labelledby="for-teams-heading">
        <div className="mb-8">
          <h2 id="for-teams-heading" className="font-display text-3xl md:text-4xl font-bold">
            Built for teams, coaches &amp; trainers
          </h2>
          <p className="text-muted-foreground mt-1">
            Recruit players, run your roster and fill your sessions — all in one place.
          </p>
        </div>
        <ul className="grid md:grid-cols-3 gap-4">
          {[
            {
              icon: Users,
              title: "For teams",
              points: [
                "Post tryouts, camps and open runs",
                "Find local players who are looking for a team",
                "Send roster invites and track who's in",
                "Collect signed waivers — parents sign for minors",
              ],
              cta: { to: "/teams/create" as const, label: "Create a team" },
            },
            {
              icon: ClipboardList,
              title: "For coaches",
              points: [
                "Announce open tryouts to athletes nearby",
                "Browse available players by sport, skill and distance",
                "Invite players with a personal note",
                "Parents of young players can message you directly",
              ],
              cta: { to: "/players" as const, label: "Find players" },
            },
            {
              icon: Dumbbell,
              title: "For trainers",
              points: [
                "Get discovered by athletes and parents nearby",
                "Host private sessions, group clinics and skill workouts",
                "Collect fees directly — no platform cut",
              ],
              cta: { to: "/trainers/create" as const, label: "Become a trainer" },
            },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <li
                key={c.title}
                className="flex flex-col rounded-3xl border border-border bg-surface p-6"
              >
                <div className="inline-grid h-11 w-11 place-items-center rounded-2xl mb-4 bg-lime/15 text-lime">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-display text-xl font-semibold">{c.title}</h3>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {c.points.map((p) => (
                    <li key={p} className="flex gap-2">
                      <span aria-hidden className="text-lime">
                        ✓
                      </span>
                      {p}
                    </li>
                  ))}
                </ul>
                <Link
                  to={c.cta.to}
                  className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-lime hover:underline"
                >
                  {c.cta.label} <ArrowRight className="h-4 w-4" />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Trending */}
      <section id="trending" className="page-shell py-16">
        <div className="flex items-end justify-between mb-6">
          <h2 className="font-display text-3xl md:text-4xl font-bold">Trending near you</h2>
          <Link
            to="/feed"
            className="text-sm font-semibold text-lime hover:underline inline-flex items-center gap-1"
          >
            See all <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        {trending.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center">
            <p className="font-semibold">No games posted near you yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Be the first to put one on the board — hosting takes about a minute.
            </p>
            <Link
              to="/create"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-lime-gradient px-5 py-3 text-sm font-bold text-primary-foreground"
            >
              Host a game <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {trending.map((g, i) => (
              <GameCard key={g.id} game={g} index={i} />
            ))}
          </div>
        )}
      </section>

      {/* FAQ */}
      <section id="faq" className="page-shell-prose py-16" aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="font-display text-3xl md:text-4xl font-bold mb-6">
          Pickup sports questions
        </h2>
        <div className="space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="rounded-2xl border border-border bg-surface p-5">
              <summary className="cursor-pointer font-semibold">{f.q}</summary>
              <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          More tips in our{" "}
          <Link to="/guide" className="text-lime hover:underline">
            Sports Guide
          </Link>{" "}
          and{" "}
          <Link to="/blog/how-to-find-pickup-soccer-games" className="text-lime hover:underline">
            how to find pickup soccer games
          </Link>
          .
        </p>
      </section>

      {/* CTA */}

      <section className="page-shell pb-24">
        <div className="relative overflow-hidden rounded-[2rem] border border-border bg-surface p-10 md:p-16 text-center">
          <div className="absolute inset-0 bg-hero opacity-60" />
          <div className="relative">
            <h2 className="font-display text-4xl md:text-6xl font-bold tracking-tight">
              Your next game is <span className="text-lime">already happening.</span>
            </h2>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
              Join the players running it back tonight.
            </p>
            <Link
              to="/feed"
              className="inline-flex items-center gap-2 mt-7 rounded-full bg-lime-gradient px-7 py-4 font-bold text-primary-foreground glow-lime hover:scale-[1.02] transition-transform"
            >
              Open ballaCity <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="page-shell py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <Logo size={22} />
          <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link to="/guide" className="hover:text-foreground">
              Sports Guide
            </Link>
            <Link to="/orgs" className="hover:text-foreground">
              Teams & Gyms
            </Link>
            <Link to="/terms" className="hover:text-foreground">
              Terms of Service
            </Link>
            <Link to="/privacy" className="hover:text-foreground">
              Privacy Policy
            </Link>
            <Link to="/cookies" className="hover:text-foreground">
              Cookies
            </Link>
            <Link to="/safety" className="hover:text-foreground">
              Safety
            </Link>
            <Link to="/trust-center" className="hover:text-foreground">
              Trust
            </Link>
            <Link to="/community-guidelines" className="hover:text-foreground">
              Guidelines
            </Link>
            <Link to="/contact" className="hover:text-foreground">
              Contact
            </Link>
          </nav>
          <span>© {new Date().getFullYear()} ballaCity. Built for the players.</span>
        </div>
      </footer>
    </div>
  );
}
