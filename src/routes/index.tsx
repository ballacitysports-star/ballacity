import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { ArrowRight, MapPin, Sparkles, Trophy, Users, Video, Zap } from "lucide-react";
import { useEffect, type CSSProperties } from "react";
import { Logo } from "@/components/Logo";
import { HERO_IMAGE, SPORTS } from "@/lib/sample-data";
import { useHostedGames } from "@/lib/hosted-games-store";
import { GameCard } from "@/components/GameCard";
import { AuthRedirectSkeleton } from "@/components/AuthRedirectSkeleton";
import { useAuth } from "@/hooks/use-auth";
import { readStoredSupabaseSession } from "@/lib/authgate-log";
import { readLastVisited } from "@/lib/last-visited";
import { isAccountType } from "@/lib/account-type";
import { supabase } from "@/integrations/supabase/client";
import { hideFinishedGames } from "@/lib/game-time";

export const Route = createFileRoute("/")({
  head: () =>
    pageHead({
      path: "/",
      title: "OpenRun — Pickup sports games near you",
      description:
        "Find and host pickup sports games near you. Basketball, soccer, pickleball, tennis and more — join a game in seconds.",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "OpenRun",
        url: "https://open-run-connect.lovable.app",
      },
    }),
  component: Landing,
});

function Landing() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const hosted = useHostedGames();
  const hasStoredSession = typeof window !== "undefined" ? !!readStoredSupabaseSession() : false;

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("account_type")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const t = (data as { account_type?: string } | null)?.account_type;
      const dest = isAccountType(t) ? (readLastVisited() ?? "/feed") : "/onboarding/account-type";
      router.navigate({ to: dest, replace: true });
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
        <div className="mx-auto max-w-6xl flex items-center justify-between px-5 py-3">
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
        <div className="relative mx-auto max-w-6xl px-5 pt-12 pb-20 md:pt-20 md:pb-32 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <div
              className="enter-up inline-flex items-center gap-2 rounded-full border border-lime/30 bg-lime/10 px-3 py-1 text-xs font-semibold text-lime"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-lime animate-pulse" />
              Live · 1,284 games this week
            </div>
            <h1
              style={{ "--enter-delay": "50ms" } as CSSProperties}
              className="enter-up mt-5 font-display text-5xl md:text-7xl font-bold leading-[0.95] tracking-tight"
            >
              Pickup sports.
              <br />
              <span className="text-lime">On demand.</span>
            </h1>
            <p
              style={{ "--enter-delay": "120ms" } as CSSProperties}
              className="enter-up mt-5 max-w-md text-lg text-muted-foreground"
            >
              Find a game in 15 seconds. Host your court. Build a crew. From hoops to pickleball —
              OpenRun connects the players around you.
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

            <div className="mt-10 grid grid-cols-3 gap-6 max-w-md">
              {[
                { k: "48k", v: "players" },
                { k: "1.2k", v: "games / wk" },
                { k: "4.9★", v: "host rating" },
              ].map((s) => (
                <div key={s.v}>
                  <div className="font-display text-3xl font-bold">{s.k}</div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {s.v}
                  </div>
                </div>
              ))}
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
                alt="OpenRun app preview"
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
            <div
              className="float-soft absolute -left-10 top-10 rounded-2xl border border-border bg-surface/90 backdrop-blur p-3 shadow-xl"
            >
              <div className="flex items-center gap-2 text-xs font-semibold">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-coral-gradient text-white">
                  ⚡
                </span>
                Marcus joined your game
              </div>
            </div>
            <div
              style={{ "--enter-delay": "500ms" } as CSSProperties}
              className="float-soft absolute -right-6 bottom-24 rounded-2xl border border-border bg-surface/90 backdrop-blur p-3 shadow-xl"
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Reliability
              </div>
              <div className="font-display text-xl font-bold text-lime">98%</div>
            </div>
          </div>
        </div>
      </section>

      {/* Sports */}
      <section id="sports" className="mx-auto max-w-6xl px-5 py-16">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="font-display text-3xl md:text-4xl font-bold">Every sport. One app.</h2>
            <p className="text-muted-foreground mt-1">
              From the cage to the court — find your run.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {SPORTS.map((s, i) => (
            <div
              key={s.name}
              style={{ "--enter-delay": `${i * 40}ms` } as CSSProperties}
              className="enter-up group rounded-2xl border border-border bg-surface p-4 hover:border-lime/40 transition-all hover:-translate-y-0.5"
            >
              <div className="text-3xl mb-2">{s.emoji}</div>
              <div className="font-semibold">{s.name}</div>
              <div className="text-xs text-muted-foreground">
                {20 + ((s.name.charCodeAt(0) * 7 + s.name.length * 13) % 80)} nearby
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-16">
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
              icon: Trophy,
              title: "Skill-balanced teams",
              body: "AI matchmaking builds even sides so every game is competitive.",
              color: "coral",
            },
            {
              icon: MapPin,
              title: "Map-first discovery",
              body: "See every pickup game on a live map of your neighborhood.",
              color: "lime",
            },
            {
              icon: Sparkles,
              title: "Pro tools, free to start",
              body: "Host unlimited games. Upgrade for analytics & priority visibility.",
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
      <section id="trending" className="mx-auto max-w-6xl px-5 py-16">
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

      {/* CTA */}

      <section className="mx-auto max-w-6xl px-5 pb-24">
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
              Open OpenRun <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-5 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <Logo size={22} />
          <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link to="/terms" className="hover:text-foreground">
              Terms of Service
            </Link>
            <Link to="/privacy" className="hover:text-foreground">
              Privacy Policy
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
          <span>© {new Date().getFullYear()} OpenRun. Built for the players.</span>
        </div>
      </footer>

    </div>
  );
}
