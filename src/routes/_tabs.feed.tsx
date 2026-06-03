import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, Bell, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { SportChips } from "@/components/SportChips";
import { GameCard } from "@/components/GameCard";
import { GAMES, SPORTS, type Sport, ME } from "@/lib/sample-data";
import { useHostedGames } from "@/lib/hosted-games-store";
import { useJoinedGameIds } from "@/lib/games-store";
import { useFeedPrefs, setFeedPrefs, DEFAULT_PREFS } from "@/lib/user-prefs-store";
import { motion, AnimatePresence } from "framer-motion";

export const Route = createFileRoute("/_tabs/feed")({
  head: () => ({ meta: [{ title: "Feed — OpenRun" }] }),
  component: Feed,
});

function Feed() {
  const [sport, setSport] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hosted = useHostedGames();
  const joinedIds = useJoinedGameIds();
  const prefs = useFeedPrefs();
  const joinedSet = useMemo(() => new Set(joinedIds), [joinedIds]);
  const hostedIds = useMemo(() => new Set(hosted.map((g) => g.id)), [hosted]);

  const filtered = useMemo(() => {
    const all = [...hosted, ...GAMES];
    return all
      .filter((g) => (sport ? g.sport === sport : true))
      .filter((g) => (prefs.preferredSports.length ? prefs.preferredSports.includes(g.sport) : true))
      .filter((g) => (prefs.sections.hostedByMeOnly ? hostedIds.has(g.id) : true))
      .filter((g) => (prefs.sections.joinedOnly ? joinedSet.has(g.id) : true))
      .filter((g) => (prefs.sections.freeOnly ? g.price === 0 : true))
      .filter((g) => (prefs.sections.paidOnly ? g.price > 0 : true))
      .filter((g) =>
        q
          ? (g.title + g.location + g.host.name).toLowerCase().includes(q.toLowerCase())
          : true,
      )
      .sort((a, b) => +new Date(a.date) - +new Date(b.date));
  }, [sport, q, hosted, prefs, joinedSet, hostedIds]);

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
        <button className="relative grid h-10 w-10 place-items-center rounded-full border border-border bg-surface">
          <Bell className="h-5 w-5" />
          <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-coral" />
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4"
      >
        <h1 className="font-display text-3xl font-bold leading-tight">Tonight's run.</h1>
        <p className="text-muted-foreground text-sm">{filtered.length} games matching your feed.</p>
      </motion.div>

      <div className="flex gap-2 mb-4">
        <div className="flex-1 flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search games, courts, players"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
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
      </div>

      <div className="mb-5">
        <SportChips selected={sport} onSelect={setSport} />
      </div>

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
              <div className="rounded-2xl border border-border bg-surface p-8 text-center text-muted-foreground">
                No games match yet.{" "}
                <Link to="/profile/edit" className="text-lime font-bold">Adjust feed</Link>.
              </div>
            )}
          </div>
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

function FilterSheet({ onClose }: { onClose: () => void }) {
  const prefs = useFeedPrefs();
  const [preferredSports, setPreferredSports] = useState<Sport[]>(prefs.preferredSports);
  const [sections, setSections] = useState(prefs.sections);

  const toggleSport = (s: Sport) =>
    setPreferredSports((prev) => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  const toggleSection = (k: keyof typeof sections) =>
    setSections((prev) => ({ ...prev, [k]: !prev[k] }));

  const apply = () => {
    setFeedPrefs({ preferredSports, sections });
    onClose();
  };
  const reset = () => {
    setPreferredSports([]);
    setSections(DEFAULT_PREFS.sections);
  };

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

        <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Preferred sports</div>
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
            ["hostedByMeOnly", "Only games I host"],
            ["joinedOnly", "Only games I joined"],
            ["freeOnly", "Free games only"],
            ["paidOnly", "Paid games only"],
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
          <button onClick={apply} className="flex-1 rounded-full bg-lime-gradient py-3 text-sm font-bold text-primary-foreground">Apply</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Suppress unused import warnings when ME isn't directly referenced
void ME;
