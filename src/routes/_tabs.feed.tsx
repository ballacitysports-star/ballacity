import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, Bell, MessageCircle, X, MapPin } from "lucide-react";
import { useUnreadNotificationCount } from "@/lib/notifications";
import { Logo } from "@/components/Logo";
import { SportChips } from "@/components/SportChips";
import { GameCard } from "@/components/GameCard";
import { GAMES, SPORTS, type Sport } from "@/lib/sample-data";
import { useHostedGames } from "@/lib/hosted-games-store";
import { useJoinedGameIds } from "@/lib/games-store";
import { useFeedPrefs, setFeedPrefs, DEFAULT_PREFS, useMyProfile } from "@/lib/user-prefs-store";
import { motion, AnimatePresence } from "framer-motion";


export const Route = createFileRoute("/_tabs/feed")({
  head: () => ({ meta: [{ title: "Feed — OpenRun" }] }),
  component: Feed,
});

function Feed() {
  const [q, setQ] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hosted = useHostedGames();
  const joinedIds = useJoinedGameIds();
  const prefs = useFeedPrefs();
  const profile = useMyProfile();
  const joinedSet = useMemo(() => new Set(joinedIds), [joinedIds]);
  const hostedIds = useMemo(() => new Set(hosted.map((g) => g.id)), [hosted]);

  const userCityToken = useMemo(
    () => (profile?.city ?? "").toLowerCase().split(",")[0].trim(),
    [profile?.city],
  );
  const isLocal = (g: { location: string; neighborhood?: string }) => {
    if (!userCityToken) return false;
    const hay = `${g.location} ${g.neighborhood ?? ""}`.toLowerCase();
    return hay.includes(userCityToken);
  };

  // Quick chip = single-sport shortcut for preferredSports.
  // null/empty = All sports. Multi-select still possible via the filter sheet.
  const chipSport: string | null =
    prefs.preferredSports.length === 1 ? prefs.preferredSports[0] : null;
  const setChipSport = (s: string | null) => {
    setFeedPrefs({ ...prefs, preferredSports: s ? [s as Sport] : [] });
  };

  const filtered = useMemo(() => {
    const all = [...hosted, ...GAMES];
    return all
      .filter((g) => (prefs.preferredSports.length ? prefs.preferredSports.includes(g.sport) : true))
      .filter((g) => (prefs.sections.hostedByMeOnly ? hostedIds.has(g.id) : true))
      .filter((g) => (prefs.sections.joinedOnly ? joinedSet.has(g.id) : true))
      .filter((g) => (prefs.sections.freeOnly ? g.price === 0 : true))
      .filter((g) => (prefs.sections.paidOnly ? g.price > 0 : true))
      .filter((g) =>
        q
          ? (g.title + " " + g.location + " " + g.host.name + " " + g.sport + " " + (g.neighborhood ?? "")).toLowerCase().includes(q.toLowerCase())
          : true,
      )
      .sort((a, b) => {
        // Nearest first when we know the user's city; ties break on distanceMi then date.
        const la = isLocal(a) ? 0 : 1;
        const lb = isLocal(b) ? 0 : 1;
        if (la !== lb) return la - lb;
        if (a.distanceMi !== b.distanceMi) return a.distanceMi - b.distanceMi;
        return +new Date(a.date) - +new Date(b.date);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, hosted, prefs, joinedSet, hostedIds, userCityToken]);

  const suggestions = useMemo(() => {
    if (!q) return [] as { label: string; sub: string }[];
    const needle = q.toLowerCase();
    const seen = new Set<string>();
    const out: { label: string; sub: string }[] = [];
    for (const g of [...hosted, ...GAMES]) {
      for (const cand of [
        { label: g.title, sub: g.location },
        { label: g.location, sub: g.sport },
        { label: g.host.name, sub: "Host" },
      ]) {
        if (out.length >= 5) break;
        if (!cand.label.toLowerCase().includes(needle)) continue;
        const key = cand.label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(cand);
      }
      if (out.length >= 5) break;
    }
    return out;
  }, [q, hosted]);



  const urgent = filtered.filter((g) => g.urgent);
  const activeFilterCount =
    (prefs.preferredSports.length > 0 ? 1 : 0) +
    Object.entries(prefs.sections).filter(([k, v]) =>
      k in DEFAULT_PREFS.sections && v !== (DEFAULT_PREFS.sections as any)[k],
    ).length;

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <div className="flex items-center justify-between mb-5">
        <Logo />
        <div className="flex items-center gap-2">
          <Link to="/messages" className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface" aria-label="Messages">
            <MessageCircle className="h-5 w-5" />
          </Link>
          <BellLink />
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4"
      >
        <h1 className="font-display text-3xl font-bold leading-tight">Tonight's run.</h1>
        <p className="text-muted-foreground text-sm inline-flex items-center gap-1">
          {userCityToken ? (
            <><MapPin className="h-3.5 w-3.5 text-lime" /> Nearest to {profile?.city} · {filtered.length} games</>
          ) : (
            <>{filtered.length} games · <Link to="/profile/edit" className="text-lime font-semibold">Set your city</Link> for nearby</>
          )}
        </p>

      </motion.div>

      <div className="flex gap-2 mb-4 relative">
        <div className="flex-1 flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search games, courts, players"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {q && (
            <button onClick={() => setQ("")} aria-label="Clear search">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
        <button
          onClick={() => setFiltersOpen(true)}
          className={`relative grid h-11 w-11 place-items-center rounded-full border bg-surface ${activeFilterCount ? "border-lime" : "border-border"}`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-lime text-[10px] font-bold text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </button>
        {q && suggestions.length > 0 && (
          <div className="absolute left-0 right-14 top-full mt-2 z-20 rounded-2xl border border-border bg-surface shadow-lg overflow-hidden">
            {suggestions.map((s, idx) => (
              <button
                key={`${s.label}-${idx}`}
                onClick={() => setQ(s.label)}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-background border-b border-border last:border-b-0"
              >
                <div className="font-semibold truncate">{s.label}</div>
                <div className="text-xs text-muted-foreground truncate">{s.sub}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-5">
        <SportChips selected={chipSport} onSelect={setChipSport} />
      </div>

      {q ? (
        <>
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
            {filtered.length} result{filtered.length === 1 ? "" : "s"} for "{q}"
          </h2>
          <div className="space-y-3">
            {filtered.map((g, i) => <GameCard key={g.id} game={g} index={i} />)}
            {filtered.length === 0 && (
              <div className="rounded-2xl border border-border bg-surface p-8 text-center text-muted-foreground">
                No games match "{q}".
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {prefs.sections.showUrgent && urgent.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-display text-sm font-bold uppercase tracking-wider text-coral">
                  ⚡ Needs players now
                </h2>
                <span className="text-xs text-muted-foreground">{urgent.length} games</span>
              </div>
              <div className="space-y-3">
                {urgent.map((g, i) => <GameCard key={g.id} game={g} index={i} />)}
              </div>
            </div>
          )}

          {prefs.sections.showForYou && (
            <>
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
                For you
              </h2>
              <div className="space-y-3">
                {filtered.map((g, i) => <GameCard key={g.id} game={g} index={i} />)}
                {filtered.length === 0 && (
                  <div className="rounded-2xl border border-border bg-surface p-8 text-center text-muted-foreground space-y-3">
                    <div>No games match your filters.</div>
                    <button
                      onClick={() => setFeedPrefs(DEFAULT_PREFS)}
                      className="inline-flex rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      <AnimatePresence>
        {filtersOpen && (
          <FilterSheet onClose={() => setFiltersOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function BellLink() {
  const unread = useUnreadNotificationCount();
  return (
    <Link to="/notifications" className="relative grid h-10 w-10 place-items-center rounded-full border border-border bg-surface" aria-label="Notifications">
      <Bell className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 grid h-4 min-w-4 px-1 place-items-center rounded-full bg-coral text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>
      )}
    </Link>
  );
}

function FilterSheet({ onClose }: { onClose: () => void }) {
  const prefs = useFeedPrefs();
  const preferredSports = prefs.preferredSports;
  const sections = prefs.sections;

  const toggleSport = (s: Sport) => {
    const next = preferredSports.includes(s)
      ? preferredSports.filter((x) => x !== s)
      : [...preferredSports, s];
    setFeedPrefs({ ...prefs, preferredSports: next });
  };
  const toggleSection = (k: keyof typeof sections) => {
    const nextSections = { ...sections, [k]: !sections[k] };
    // Mutually exclusive pairs to prevent empty-feed states
    if (k === "paidOnly" && nextSections.paidOnly) nextSections.freeOnly = false;
    if (k === "freeOnly" && nextSections.freeOnly) nextSections.paidOnly = false;
    if (k === "hostedByMeOnly" && nextSections.hostedByMeOnly) nextSections.joinedOnly = false;
    if (k === "joinedOnly" && nextSections.joinedOnly) nextSections.hostedByMeOnly = false;
    setFeedPrefs({ ...prefs, sections: nextSections });
  };

  const reset = () => setFeedPrefs({ preferredSports: [], sections: DEFAULT_PREFS.sections });


  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur flex items-end justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 280, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl border-t border-border bg-background p-5 max-h-[85vh] overflow-y-auto pb-10"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-bold">Feed filters</h2>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-border">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Sport (Games)</div>
        <div className="flex flex-wrap gap-2 mb-5">
          {SPORTS.map((s) => {
            const active = preferredSports.includes(s.name);
            return (
              <button
                key={s.name} onClick={() => toggleSport(s.name)}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? "border-lime bg-lime text-primary-foreground" : "border-border bg-surface"}`}
              >
                <span>{s.emoji}</span>{s.name}
              </button>
            );
          })}
        </div>

        <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Sections</div>
        <div className="space-y-2 mb-5">
          {([
            ["showUrgent", "Needs players now"],
            ["showForYou", '"For you" list'],
            ["hostedByMeOnly", "Games I host"],
            ["joinedOnly", "Games I joined"],
            ["freeOnly", "Free games"],
            ["paidOnly", "Paid games"],
          ] as const).map(([k, label]) => (
            <button
              key={k} onClick={() => toggleSection(k)}
              className="w-full flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-semibold"
            >
              <span>{label}</span>
              <span className={`h-6 w-10 rounded-full p-0.5 transition-colors ${sections[k] ? "bg-lime" : "bg-secondary"}`}>
                <span className={`block h-5 w-5 rounded-full bg-background transition-transform ${sections[k] ? "translate-x-4" : ""}`} />
              </span>
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button onClick={reset} className="flex-1 rounded-full border border-border py-3 text-sm font-bold">Reset</button>
          <button onClick={onClose} className="flex-1 rounded-full bg-lime-gradient py-3 text-sm font-bold text-primary-foreground">Done</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

