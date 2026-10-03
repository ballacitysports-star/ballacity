import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ogImageUrl, pageHead, SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/lib/seo";
import { ArrowRight, MapPin, Users, Video, Zap } from "lucide-react";
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
            <a href="#features" className="hover:text-foreground">
              Features
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
              Join local pickup basketball, soccer, baseball, pickleball and more. Discover games,
              teams, trainers and gyms in your area — or host your own run in about a minute.
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

          <div
            style={{ "--enter-delay": "100ms" } as CSSProperties}
            className="enter-pop relative mx-auto w-[300px] md:w-[340px]"
          >
            {/* Phone frame */}
            <div className="relative rounded-[2.5rem] border-[10px] border-surface-2 bg-background shadow-2xl glow-coral overflow-hidden">
              <img
                src={HERO_IMAGE}
                alt="ballaCity app showing a local pickup basketball game with open spots"
                className="h-[560px] w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
              <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
                <span className="rounded-full bg-background/70 backdrop-blur px-2.5 py-1 text-[10px] font-semibold">
                  🏀 Basketball
                </span>
                <span className="rounded-full bg-coral-gradient px-2.5 py-1 text-[10px] font-bold text-white">
                  2 spots left
                </span>
              </div>
              <div className="absolute bottom-5 left-4 right-4 space-y-2">
                <h3 className="font-display text-xl font-bold leading-tight">
                  Friday Night Run · 5v5
                </h3>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 text-coral" /> Tompkins Square · 0.8 mi
                </div>
                <button className="w-full rounded-2xl bg-lime-gradient py-3 text-sm font-bold text-primary-foreground">
                  Join game
                </button>
              </div>
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

      {/* Features */}
      <section id="features" className="page-shell py-16">
        <h2 className="font-display text-3xl md:text-4xl font-bold mb-10">
          Built for players, not paperwork.
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            {
              icon: Zap,
              title: "Join in 15 seconds",
              body: "Tap a game, claim a spot. No back-and-forth in group chats.",
              color: "lime",
            },
            {
              icon: Users,
              title: "Real community",
              body: "Reliability scores and sportsmanship ratings keep games great.",
              color: "coral",
            },
            {
              icon: Video,
              title: "AI highlight reels",
              body: "Upload raw footage. Get cinematic clips ready for Reels & TikTok.",
              color: "lime",
            },
            {
              icon: MapPin,
              title: "Map-first discovery",
              body: "See every pickup game on a live map of your neighborhood.",
              color: "coral",
            },
          ].map((f, i) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                style={{ "--enter-delay": `${i * 50}ms` } as CSSProperties}
                className="enter-up rounded-3xl border border-border bg-surface p-6"
              >
                <div
                  className={`inline-grid h-11 w-11 place-items-center rounded-2xl mb-4 ${f.color === "lime" ? "bg-lime/15 text-lime" : "bg-coral/15 text-coral"}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-display text-xl font-semibold">{f.title}</h3>
                <p className="text-muted-foreground mt-1.5 text-sm">{f.body}</p>
              </div>
            );
          })}
        </div>
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
