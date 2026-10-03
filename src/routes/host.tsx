import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, MapPin, Users, Wallet, BellRing, Share2, Check } from "lucide-react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { toast } from "sonner";
import { pageHead } from "@/lib/seo";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { formatGameWhen } from "@/lib/format";
import { UnpaidPlayersPanel } from "@/components/payments/UnpaidPlayersPanel";

export const Route = createFileRoute("/host")({
  head: () =>
    pageHead({
      path: "/host",
      title: "Host Dashboard — ballaCity",
      description: "Manage your hosted games, unpaid players and payment reminders.",
      noindex: true,
    }),
  validateSearch: zodValidator(
    z.object({ tab: fallback(z.string(), "").default("") }),
  ),
  component: HostDashboard,
});

type HostedGame = {
  id: string;
  title: string;
  date: string;
  price: number | null;
  location: string | null;
  cancelled_at: string | null;
};

function HostDashboard() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const search = Route.useSearch();
  const tab: "games" | "payments" = search.tab === "payments" ? "payments" : "games";
  const setTab = (v: "games" | "payments") =>
    nav({ to: "/host", search: (p: any) => ({ ...p, tab: v === "games" ? "" : v }), replace: true });

  const [games, setGames] = useState<HostedGame[] | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const shareGame = async (g: HostedGame) => {
    const url = `${window.location.origin}/games/${g.id}`;
    const text = `Join my game "${g.title}" on ballaCity — ${formatGameWhen({ date: g.date })}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: g.title, text, url });
        return;
      } catch {
        /* user cancelled or share unsupported — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this invite link:", url);
    }
    setCopiedId(g.id);
    toast.success("Invite link copied — send it to your players");
    setTimeout(() => setCopiedId((c) => (c === g.id ? null : c)), 2000);
  };

  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [loading, user, nav]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    supabase
      .from("hosted_games")
      .select("id, title, date, price, location, cancelled_at")
      .eq("host_id", user.id)
      .order("date", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (alive) setGames((data as HostedGame[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!user) return null;

  const upcoming = (games ?? []).filter(
    (g) => !g.cancelled_at && g.date >= new Date().toISOString().slice(0, 10),
  );

  return (
    <div className="page-shell-narrow pt-6 pb-24">
      <div className="mb-5 flex items-center gap-3">
        <Link
          to="/profile"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="page-title">Host dashboard</h1>
          <p className="text-xs text-muted-foreground">
            Your games, players and payments in one place.
          </p>
        </div>
      </div>

      <div className="mb-4 flex gap-1 rounded-2xl border border-border bg-surface p-1">
        <button
          onClick={() => setTab("games")}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-colors ${
            tab === "games" ? "bg-lime text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          <CalendarDays className="h-4 w-4" /> Games
        </button>
        <button
          onClick={() => setTab("payments")}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-colors ${
            tab === "payments" ? "bg-lime text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          <Wallet className="h-4 w-4" /> Payments
        </button>
      </div>

      {tab === "payments" ? (
        <UnpaidPlayersPanel />
      ) : games === null ? (
        <div className="p-4 text-sm text-muted-foreground">Loading…</div>
      ) : games.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-6 text-center">
          <div className="font-display text-base font-bold">No games yet</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Host your first pickup game and it'll show up here.
          </p>
          <Link
            to="/create"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-lime px-4 py-2 text-xs font-bold text-primary-foreground"
          >
            Host a game
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-2xl border border-border bg-surface p-3 text-sm">
            <span className="font-semibold">{upcoming.length}</span>{" "}
            <span className="text-muted-foreground">
              upcoming game{upcoming.length === 1 ? "" : "s"} · {games.length} total
            </span>
          </div>
          {games.map((g) => (
            <Link
              key={g.id}
              to="/games/$gameId"
              params={{ gameId: g.id }}
              className="block rounded-2xl border border-border bg-surface p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{g.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" /> {formatGameWhen({ date: g.date })}
                    </span>
                    {g.location && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3" /> {g.location}
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {g.cancelled_at ? (
                    <span className="text-xs font-semibold text-coral">Cancelled</span>
                  ) : (
                    <span className="text-xs font-semibold text-lime">
                      {Number(g.price) > 0 ? `$${Number(g.price).toFixed(2)}` : "Free"}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
          <Link
            to="/payments"
            search={{ tab: "unpaid" } as any}
            className="flex items-center justify-center gap-1.5 rounded-2xl border border-border bg-surface py-2.5 text-xs font-semibold text-muted-foreground"
          >
            <BellRing className="h-3.5 w-3.5" /> Open full payments hub
          </Link>
        </div>
      )}

      {tab === "payments" && (
        <p className="mt-4 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
          <Users className="h-3 w-3" /> Reminders send each player an in-app alert with a link to pay you.
        </p>
      )}
    </div>
  );
}
