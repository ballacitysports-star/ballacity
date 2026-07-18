import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, Plus, Megaphone, Users, GraduationCap, ArrowUpDown, MapPin } from "lucide-react";
import { type OrgKind, type Sport } from "@/lib/sample-data";
import { useAllOrgs } from "@/lib/org-store";
import { OrgCard } from "@/components/OrgCard";
import { SportChips } from "@/components/SportChips";
import { ViewDensityToggle, type ViewMode, type Density } from "@/components/ViewDensityToggle";
import { PlayMapView } from "@/components/PlayMapView";
import { useMyProfile } from "@/lib/user-prefs-store";
import { useAuth } from "@/hooks/use-auth";


type SortBy = "nearest" | "followers" | "name";

// Deterministic pseudo-distance (miles) from a string, so sort order is stable.
function pseudoDistance(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return Math.round(((h % 400) / 10 + 0.3) * 10) / 10; // 0.3 – 40.3 mi
}

export const Route = createFileRoute("/_tabs/teams")({
  head: () => ({ meta: [{ title: "Teams & Coaches — OpenRun" }] }),
  component: TeamsPage,
});

const KIND_META: Record<
  OrgKind,
  {
    label: string;
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    emptyText: string;
    icon: typeof Users;
    featuredBadge: string;
  }
> = {
  team: {
    label: "Teams",
    title: "Teams & clubs.",
    subtitle: "Follow squads, find tryouts, join open runs.",
    searchPlaceholder: "Search teams, sport, city",
    emptyText: "No teams match.",
    icon: Users,
    featuredBadge: "Hiring · 3 spots",
  },
  coach: {
    label: "Coaches",
    title: "Coaches & trainers.",
    subtitle: "Book sessions, join clinics, level up your game.",
    searchPlaceholder: "Search coaches, sport, credential",
    emptyText: "No coaches match.",
    icon: GraduationCap,
    featuredBadge: "Booking · clinics open",
  },
};

function TeamsPage() {
  const { user } = useAuth();
  const profile = useMyProfile(user);
  const [kind, setKind] = useState<OrgKind>("team");
  const [q, setQ] = useState("");
  const [sport, setSport] = useState<Sport | null>(null);

  const [sortBy, setSortBy] = useState<SortBy>("nearest");
  const [avail, setAvail] = useState<"any" | "recruiting" | "weekly" | "casual">("any");
  const [density, setDensity] = useState<Density>(() => {
    if (typeof window === "undefined") return "list";
    return (localStorage.getItem("openrun:teams-density") as Density) ?? "list";
  });
  const switchDensity = (d: Density) => {
    setDensity(d);
    try { localStorage.setItem("openrun:teams-density", d); } catch { /* ignore */ }
  };
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "list";
    return (localStorage.getItem("openrun:teams-view") as ViewMode) ?? "list";
  });
  const switchView = (v: ViewMode) => {
    setViewMode(v);
    try { localStorage.setItem("openrun:teams-view", v); } catch { /* ignore */ }
  };
  const orgs = useAllOrgs();
  const meta = KIND_META[kind];

  const list = useMemo(() => {
    const isRecruiting = (o: typeof orgs[number]) => {
      const pn = o.positionsNeeded;
      if (!pn) return false;
      return Object.values(pn).some((byPos) =>
        Object.values(byPos ?? {}).some((n) => Number(n) > 0),
      );
    };
    const cadenceMatches = (o: typeof orgs[number], target: "weekly" | "casual") => {
      const c = (o.cadence ?? "").toLowerCase();
      if (!c) return false;
      if (target === "weekly") return /week|multiple|daily/.test(c);
      return /month|casual|occasion|pickup|drop/.test(c);
    };
    const filtered = orgs
      .filter((o) => o.kind === kind)
      .filter((o) => (sport ? o.sports.includes(sport) : true))
      .filter((o) => {
        if (avail === "any") return true;
        if (avail === "recruiting") return isRecruiting(o);
        return cadenceMatches(o, avail);
      })
      .filter((o) =>
        q
          ? (o.name + o.handle + o.tagline + o.city + o.sports.join(" "))
              .toLowerCase()
              .includes(q.toLowerCase())
          : true,
      );
    const withDist = filtered.map((o) => ({ o, dist: pseudoDistance(o.id) }));
    withDist.sort((a, b) => {
      if (sortBy === "nearest") return a.dist - b.dist;
      if (sortBy === "followers") return b.o.followers - a.o.followers;
      return a.o.name.localeCompare(b.o.name);
    });
    return withDist;
  }, [orgs, kind, sport, q, sortBy, avail]);

  const featured =
    orgs.find((o) => o.verified && o.kind === kind) ?? orgs.find((o) => o.kind === kind);

  return (
    <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4 pt-6">
      <motion.div
        key={kind + "-header"}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4"
      >
        <h1 className="font-display text-3xl font-bold leading-tight">{meta.title}</h1>
        <p className="text-muted-foreground text-sm inline-flex items-center gap-1">
          {profile?.city ? (
            <>
              <MapPin className="h-3.5 w-3.5 text-lime" /> Nearest to {profile.city} ·{" "}
              {list.length} {list.length === 1 ? "result" : "results"}
            </>
          ) : (
            <>
              {list.length} {list.length === 1 ? "result" : "results"} ·{" "}
              <Link to="/profile/edit" className="text-lime font-semibold">
                Set your city
              </Link>{" "}
              for nearby
            </>
          )}
        </p>

      </motion.div>

      {/* Kind segmented control — primary split */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border border-border bg-surface p-1">
        {(["team", "coach"] as OrgKind[]).map((k) => {
          const m = KIND_META[k];
          const Icon = m.icon;
          const active = kind === k;
          return (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`relative flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                active ? "bg-lime text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={2.5} />
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Featured banner */}
      {featured && (
        <motion.div
          key={kind + "-featured"}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative mb-5 overflow-hidden rounded-3xl border border-lime/30 bg-surface"
        >
          <img src={featured.cover} alt="" className="h-32 w-full object-cover opacity-50" />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
          <div className="absolute inset-0 p-4 flex flex-col justify-end">
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime uppercase tracking-wider">
              <Megaphone className="h-3 w-3" /> {meta.featuredBadge}
            </span>
            <div className="mt-1 font-display text-xl font-bold">
              {featured.name} · {kind === "team" ? "Open Tryouts" : "Now Booking"}
            </div>
            <div className="text-xs text-muted-foreground">{featured.tagline}</div>
          </div>
        </motion.div>
      )}

      {/* Search */}
      <ViewDensityToggle
        view={viewMode}
        onViewChange={switchView}
        density={density}
        onDensityChange={switchDensity}
      />

      <div className="flex gap-2 mb-4">
        <div className="flex-1 flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={meta.searchPlaceholder}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <Link
          to="/teams/create"
          className="grid h-11 w-11 place-items-center rounded-full bg-lime-gradient text-primary-foreground glow-lime"
          aria-label={kind === "team" ? "Create team" : "Create coach profile"}
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </Link>
      </div>




      {/* Sport filter chips */}
      <div className="mb-3">
        <SportChips selected={sport} onSelect={(s) => setSport(s as Sport | null)} />
      </div>

      {/* Availability filter chips */}
      <div className="-mx-4 overflow-x-auto px-4 mb-4">
        <div className="flex gap-2 pb-1">
          {([
            { id: "any", label: "Any availability" },
            { id: "recruiting", label: kind === "coach" ? "Booking now" : "Recruiting" },
            { id: "weekly", label: "Weekly+" },
            { id: "casual", label: "Casual" },
          ] as const).map((a) => {
            const active = avail === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setAvail(a.id)}
                className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "border-lime bg-lime text-primary-foreground"
                    : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      </div>



      {/* Sort control + result count */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {list.length} {list.length === 1 ? "result" : "results"}
        </span>
        <label className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="bg-transparent outline-none"
            aria-label="Sort teams"
          >
            <option value="nearest">Nearest</option>
            <option value="followers">Most followers</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
      </div>

      <ViewDensityToggle
        view={viewMode}
        onViewChange={switchView}
        density={density}
        onDensityChange={switchDensity}
      />

      {viewMode === "map" ? (
        <PlayMapView />
      ) : (
        <div
          className={
            density === "grid"
              ? "grid grid-cols-1 sm:grid-cols-2 gap-3 pb-6"
              : "space-y-3 pb-6"
          }
        >
          {list.map(({ o, dist }, i) => (
            <div key={o.id} className="relative">
              <OrgCard org={o} index={i} />
              <span className="pointer-events-none absolute top-3 right-3 rounded-full bg-background/70 backdrop-blur px-2 py-0.5 text-[10px] font-bold text-foreground">
                {dist} mi
              </span>
            </div>
          ))}
          {list.length === 0 && (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center text-muted-foreground sm:col-span-2">
              {meta.emptyText}
            </div>
          )}
        </div>
      )}


    </div>
  );
}
