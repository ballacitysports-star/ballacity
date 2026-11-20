import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ogImageUrl, pageHead, SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/lib/seo";
import {
  ArrowRight,
  BellRing,
  Building2,
  CalendarClock,
  Dumbbell,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import { Logo } from "@/components/Logo";
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
import { orderSportsByPriority } from "@/lib/sport-hubs";
import { TryoutsSection } from "@/components/tryouts/TryoutsSection";
import { FeaturedFacilityTrainer } from "@/components/landing/FeaturedFacilityTrainer";
import { useLandingListingsConfig } from "@/hooks/useLandingListingsConfig";

/** Every sport stays on the landing page; Basketball leads, then the usual priority order. */
const LANDING_SPORTS = orderSportsByPriority(SPORT_GUIDES.map((g) => ({ name: g.sport, g }))).map(
  (s) => s.g,
);

/** The pickup loop the landing page leads with: post when you're free, get invited, play. */
const HOW_STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: CalendarClock,
    title: "Post when you're free",
    body: "Pick your sport, your level and the times you can play. It takes under a minute.",
  },
  {
    icon: BellRing,
    title: "Get invited",
    body: "Hosts near you see you're free and invite you to a game that fits your time and level.",
  },
  {
    icon: Users,
    title: "Show up and play",
    body: "Accept, get the details and meet your crew at the court. Rate the game and run it back.",
  },
];

const FAQS = [
  {
    q: "How do invites work?",
    a: "Post your availability: your sport, skill level and when you're free. Hosts nearby can invite you to a game, and you choose which invites to accept.",
  },
  {
    q: "How do I find pickup basketball near me?",
    a: "Open BallaCity, allow location or pick your city, and browse open games by sport, skill level and distance. Tap a game to see the time, place and open spots. Soccer, pickleball, volleyball and other sports work the same way.",
  },
  {
    q: "Do I need a team to join?",
    a: "No. Pickup games are built for individual players. Request a spot and the host balances teams when everyone arrives.",
  },
  {
    q: "Is BallaCity free?",
    a: "Yes, finding and joining games is free. Some hosts charge a small fee for court or field costs, which is shown on the game before you join.",
  },
  {
    q: "Can I host my own game?",
    a: "Yes. Set the sport, place, time and number of players, and your game appears for nearby players in about a minute. You can also invite players who have posted that they're free.",
  },
  {
    q: "How do teams and coaches find me?",
    a: "The same availability post works for teams too. Teams and coaches browse available players by sport, skill and distance, and send invites straight to you.",
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
        title: "Post when you're free. Get invited to play.",
        subtitle: "Pickup basketball near you, plus soccer, pickleball and more.",
        meta: ["Basketball", "Pickup games", "Every sport"],
      }),
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "BallaCity",
          url: `${SITE_URL}/`,
          description: SITE_DESCRIPTION,
        },
        {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "BallaCity",
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
  const { visible } = useLandingListingsConfig();
  const hasStoredSession = typeof window !== "undefined" ? !!readStoredSupabaseSession() : false;
  // Clearing the hint below updates the user, which runs the effect again; that
  // run sees no hint and would send them on to the feed over their setup.
  const startedSetup = useRef(false);

  useEffect(() => {
    if (loading || !user || startedSetup.current) return;
    // Only from the landing page itself. While another navigation is still
    // loading its route, the router keeps this page on screen with the new URL
    // already in place; a new user object then (a sign-in event, a refresh)
    // re-ran this and dragged the member back from wherever they were sent,
    // e.g. from the account-type picker an OAuth return routes to.
    if (router.state.location.pathname !== "/") return;
    // A returning member has nothing to route through first: go straight on.
    // A member who has not picked a role is caught by the app shell's own
    // account-type check, so the profile lookup below is only for a pending setup.
    if (!startSetupOf(user)) {
      router.navigate({ to: readLastVisited() ?? "/feed", replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("account_type")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled || router.state.location.pathname !== "/") return;
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
          <div className="flex items-center gap-5">
            <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-muted-foreground">
              <a href="#how" className="hover:text-foreground">
                How it works
              </a>
              {visible.pickupGames && (
                <a href="#trending" className="hover:text-foreground">
                  Games
                </a>
              )}
              <a href="#more" className="hover:text-foreground">
                Tryouts &amp; trainers
              </a>
              <a href="#sports" className="hover:text-foreground">
                Sports
              </a>
            </nav>
            <Link
              to="/auth"
              className="rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-semibold text-foreground hover:border-lime/50 hover:text-lime transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* Hero: basketball first, availability first */}
      <section className="relative overflow-hidden bg-hero">
        <div className="absolute inset-0 grid-noise opacity-30" />
        <div className="relative page-shell pt-12 pb-16 md:pt-20 md:pb-24">
          <div className="max-w-3xl">
            <p
              style={{ "--enter-delay": "0ms" } as CSSProperties}
              className="enter-up inline-flex items-center gap-2 rounded-full border border-lime/30 bg-lime/10 px-3.5 py-1.5 text-sm font-semibold text-lime"
            >
              <span aria-hidden>🏀</span> Pickup basketball in your city
            </p>
            <h1
              style={{ "--enter-delay": "50ms" } as CSSProperties}
              className="enter-up mt-5 font-display text-5xl md:text-7xl font-bold leading-[0.95] tracking-tight"
            >
              Post when you're free.
              <br />
              <span className="text-lime">Get invited to play.</span>
            </h1>
            <p
              style={{ "--enter-delay": "120ms" } as CSSProperties}
              className="enter-up mt-5 max-w-xl text-lg text-muted-foreground"
            >
              Tell hoopers nearby when you can play, and hosts invite you to runs that fit your time
              and level. Or jump into an open game today. Soccer, pickleball, volleyball and more
              are here too.
            </p>
            <div
              style={{ "--enter-delay": "180ms" } as CSSProperties}
              className="enter-up mt-7 flex flex-wrap gap-3"
            >
              <Link
                to="/availability"
                search={{ compose: "quick" }}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-lime-gradient px-6 py-3.5 font-bold text-primary-foreground glow-lime hover:scale-[1.02] transition-transform"
              >
                Post when you're free <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/feed"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-6 py-3.5 font-semibold text-foreground hover:border-lime/40"
              >
                Find a game near me
              </Link>
            </div>
            <p
              style={{ "--enter-delay": "220ms" } as CSSProperties}
              className="enter-up mt-4 text-sm text-muted-foreground"
            >
              Running a game?{" "}
              <Link
                to="/create"
                className="inline-flex min-h-11 items-center font-semibold text-foreground underline-offset-4 hover:text-lime hover:underline"
              >
                Host a game
              </Link>{" "}
              and invite players who are free.
            </p>
            <nav
              aria-label="On this page"
              style={{ "--enter-delay": "260ms" } as CSSProperties}
              className="enter-up mt-6 flex flex-wrap gap-2"
            >
              {[
                ["#how", "🙋 How invites work"],
                visible.pickupGames && ["#trending", "🏀 Games near you"],
                ["#more", "📋 Tryouts, trainers & facilities"],
                ["#sports", "⚽ Every sport"],
              ]
                .filter((x): x is string[] => !!x)
                .map(([href, label]) => (
                  <a
                    key={href}
                    href={href}
                    className="inline-flex min-h-11 items-center rounded-full border border-border bg-background/50 px-3.5 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-lime/40 transition-colors"
                  >
                    {label}
                  </a>
                ))}
            </nav>
          </div>
        </div>
      </section>

      {/* How it works: post when you're free, get invited */}
      <section id="how" className="page-shell py-16 scroll-mt-20" aria-labelledby="how-heading">
        <div className="mb-8">
          <h2 id="how-heading" className="font-display text-3xl md:text-4xl font-bold">
            Post when you're free. Get invited.
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            No more group-chat chasing. Say when you can play and let the game come to you.
          </p>
        </div>
        <ol className="grid md:grid-cols-3 gap-4">
          {HOW_STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.title} className="rounded-3xl border border-border bg-surface p-6">
                <div className="flex items-center gap-3">
                  <div className="inline-grid h-11 w-11 place-items-center rounded-2xl bg-lime/15 text-lime">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <span className="font-display text-2xl font-bold text-lime">{i + 1}</span>
                </div>
                <h3 className="mt-4 font-display text-xl font-semibold">{s.title}</h3>
                <p className="text-muted-foreground mt-1.5 text-sm">{s.body}</p>
              </li>
            );
          })}
        </ol>
        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            to="/availability"
            search={{ compose: "quick" }}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-lime-gradient px-6 py-3.5 font-bold text-primary-foreground glow-lime hover:scale-[1.02] transition-transform"
          >
            Post your availability <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/feed"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            <Search className="h-4 w-4" aria-hidden /> Or browse open games
          </Link>
        </div>
      </section>

      {/* Trending */}
      {visible.pickupGames && (
        <section
          id="trending"
          className="page-shell py-16 scroll-mt-20"
          aria-labelledby="trending-heading"
        >
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 mb-6">
            <h2 id="trending-heading" className="font-display text-3xl md:text-4xl font-bold">
              Games near you
            </h2>
            <Link
              to="/feed"
              className="text-sm font-semibold text-lime hover:underline inline-flex min-h-11 items-center gap-1"
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
      )}

      {/* Sports: Basketball leads, every other sport stays one tap away */}
      <section
        id="sports"
        className="page-shell py-16 scroll-mt-20"
        aria-labelledby="sports-heading"
      >
        <div className="mb-6">
          <h2 id="sports-heading" className="font-display text-3xl md:text-4xl font-bold">
            Basketball first. Every sport welcome.
          </h2>
          <p className="text-muted-foreground mt-1">
            The same post-and-get-invited pickup works for soccer, pickleball, volleyball, baseball
            and more.
          </p>
        </div>
        <ul className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {LANDING_SPORTS.map((g, i) => (
            <li key={g.slug}>
              <Link
                to="/guide/$sport"
                params={{ sport: g.slug }}
                style={{ "--enter-delay": `${i * 40}ms` } as CSSProperties}
                className={
                  i === 0
                    ? "enter-up block h-full rounded-2xl border border-lime/50 bg-lime/10 p-4 hover:border-lime transition-all hover:-translate-y-0.5"
                    : "enter-up block h-full rounded-2xl border border-border bg-surface p-4 hover:border-lime/40 transition-all hover:-translate-y-0.5"
                }
              >
                <span aria-hidden className="block text-3xl mb-2">
                  {g.emoji}
                </span>
                <span className="font-semibold">{g.sport}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Tryouts, teams, trainers & facilities: one compact section */}
      <section id="more" className="page-shell py-16 scroll-mt-20" aria-labelledby="more-heading">
        <div className="mb-6">
          <h2 id="more-heading" className="font-display text-3xl md:text-4xl font-bold">
            Tryouts, trainers &amp; facilities
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Beyond pickup: find a team, train with a coach, or put your gym on the map.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: Users,
              title: "Teams & tryouts",
              body: "Teams post tryouts and camps and invite players who are free. Parents sign waivers for minors.",
              cta: { to: "/teams" as const, label: "Browse teams" },
              cta2: { to: "/teams/create" as const, label: "Create a team" },
            },
            {
              icon: Dumbbell,
              title: "Trainers",
              body: "Private sessions, group clinics and skill workouts. Fees are paid to the trainer directly.",
              cta: { to: "/trainers" as const, label: "Find a trainer" },
              cta2: { to: "/trainers/create" as const, label: "Become a trainer" },
            },
            {
              icon: Building2,
              title: "Gyms & facilities",
              body: "List your courts and fields so players, teams and trainers nearby can find them.",
              cta: { to: "/orgs" as const, label: "Explore facilities" },
              cta2: { to: "/orgs/create" as const, label: "List your facility" },
            },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <li
                key={c.title}
                className="flex flex-col rounded-2xl border border-border bg-surface p-5"
              >
                <div className="flex items-center gap-3">
                  <div className="inline-grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime/15 text-lime">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="font-display text-lg font-semibold">{c.title}</h3>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
                <div className="mt-auto pt-3 flex flex-wrap gap-x-4">
                  <Link
                    to={c.cta.to}
                    className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-lime hover:underline"
                  >
                    {c.cta.label} <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    to={c.cta2.to}
                    className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
                  >
                    {c.cta2.label}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
        {visible.availability && (
          <p className="mt-4 text-sm text-muted-foreground">
            Looking for a team? Your availability post lets teams and coaches find you and invite
            you to try out.{" "}
            <Link
              to="/availability"
              search={{ compose: "quick" }}
              className="inline-flex min-h-11 items-center font-semibold text-lime hover:underline"
            >
              Get found by teams
            </Link>
          </p>
        )}
        {visible.tryouts && <TryoutsSection compact />}
        {visible.trainerSpotlight && <FeaturedFacilityTrainer />}
      </section>

      {/* FAQ */}
      <section id="faq" className="page-shell-prose py-16" aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="font-display text-3xl md:text-4xl font-bold mb-6">
          Common questions
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
              Free tonight? <span className="text-lime">Let the run find you.</span>
            </h2>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
              Post when you're free and get invited to pickup basketball near you, or any sport you
              play.
            </p>
            <Link
              to="/availability"
              search={{ compose: "quick" }}
              className="inline-flex items-center gap-2 mt-7 rounded-full bg-lime-gradient px-7 py-4 font-bold text-primary-foreground glow-lime hover:scale-[1.02] transition-transform"
            >
              Get started <ArrowRight className="h-4 w-4" />
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
              Teams & Venues
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
            <Link to="/payment-policy" className="hover:text-foreground">
              Payments
            </Link>
            <Link to="/ai-disclosure" className="hover:text-foreground">
              AI
            </Link>
            <Link to="/youth-policy" className="hover:text-foreground">
              Youth
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
          <span>© {new Date().getFullYear()} BallaCity. Built for the players.</span>
        </div>
      </footer>
    </div>
  );
}
