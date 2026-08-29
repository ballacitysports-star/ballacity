import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronUp, MapPin, Navigation, Users, Swords, Loader2 } from "lucide-react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { UserAvatar } from "@/components/UserAvatar";
import { usePrefetchUserAvatars } from "@/lib/user-avatars";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

import { Distance } from "@/components/Distance";
import { geocodeAddress } from "@/lib/geocode.functions";
import { haversineKm, useUserLocation, type LatLng } from "@/lib/geo";
import { SPORTS } from "@/lib/sample-data";
import { resolvePlayerLevel, formatSportLevel } from "@/lib/sport-levels";

import type { AvailabilityWithAuthor } from "@/lib/availability";

const emojiBySport: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.name, s.emoji]),
);

type Relation = "all" | "teammates" | "competitors";

const RELATIONS: { id: Relation; label: string; icon: typeof Users }[] = [
  { id: "all", label: "Everyone", icon: MapPin },
  { id: "teammates", label: "Teammates", icon: Users },
  { id: "competitors", label: "Competitors", icon: Swords },
];

/**
 * Nearby players discovery panel.
 *
 * Origin is the device location when the viewer grants it, otherwise their
 * profile city. Player positions come from each availability post's city,
 * geocoded and cached for a day (same source the players map uses), so posts
 * without a city are simply left out of the nearby ranking.
 *
 * "Teammates" = shares at least one sport with the viewer.
 * "Competitors" = plays a sport the viewer doesn't list.
 */
export function NearbyPlayersPanel({
  players,
  mySports,
  myCity,
  currentUserId,
  limit = 12,
}: {
  players: AvailabilityWithAuthor[] | null;
  mySports?: string[];
  myCity?: string | null;
  currentUserId?: string | null;
  limit?: number;
}) {
  const geocode = useServerFn(geocodeAddress);
  const { coords, status, request } = useUserLocation();
  const [relation, setRelation] = useState<Relation>("all");

  const candidates = useMemo(
    () => (players ?? []).filter((p) => p.user_id !== currentUserId && !!p.city?.trim()),
    [players, currentUserId],
  );

  const uniqueCities = useMemo(() => {
    const set = new Set<string>();
    candidates.forEach((p) => {
      const c = p.city?.trim();
      if (c) set.add(c);
    });
    return Array.from(set);
  }, [candidates]);

  const cityQueries = useQueries({
    queries: uniqueCities.map((city) => ({
      queryKey: ["geocode-city", city.toLowerCase()],
      queryFn: () => geocode({ data: { address: city } }),
      staleTime: 24 * 60 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
    })),
  });

  const originCity = myCity?.trim() || "";
  const originQuery = useQuery({
    queryKey: ["geocode-city", originCity.toLowerCase()],
    queryFn: () => geocode({ data: { address: originCity } }),
    enabled: !coords && originCity.length > 1,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  const origin: LatLng | null = coords
    ? coords
    : originQuery.data
      ? { lat: originQuery.data.lat, lng: originQuery.data.lng }
      : null;
  const originLabel = coords ? "your location" : originCity || null;

  const cityCoords = useMemo(() => {
    const map = new Map<string, LatLng>();
    uniqueCities.forEach((city, i) => {
      const d = cityQueries[i]?.data;
      if (d) map.set(city.toLowerCase(), { lat: d.lat, lng: d.lng });
    });
    return map;
  }, [uniqueCities, cityQueries]);

  const mine = useMemo(
    () => new Set((mySports ?? []).map((s) => s.toLowerCase())),
    [mySports],
  );

  const ranked = useMemo(() => {
    if (!origin) return [];
    const seen = new Set<string>();
    return candidates
      .map((p) => {
        const key = p.city!.trim().toLowerCase();
        const at = cityCoords.get(key);
        if (!at) return null;
        const shared = p.sports.some((s) => mine.has(s.toLowerCase()));
        return { player: p, km: haversineKm(origin, at), shared };
      })
      .filter((r): r is { player: AvailabilityWithAuthor; km: number; shared: boolean } => !!r)
      .filter((r) => {
        if (relation === "teammates" && !r.shared) return false;
        if (relation === "competitors" && r.shared) return false;
        // One card per person — the nearest/newest post wins.
        if (seen.has(r.player.user_id)) return false;
        seen.add(r.player.user_id);
        return true;
      })
      .sort((a, b) => a.km - b.km)
      .slice(0, limit);
  }, [candidates, cityCoords, origin, relation, mine, limit]);

  const resolving =
    !!origin && cityQueries.some((q) => q.isLoading) && ranked.length === 0;

  // Nearest players render first, so their photos get the urgent tier.
  usePrefetchUserAvatars(
    ranked.map((r) => r.player.user_id),
    "high",
  );



  const [open, setOpen] = useState(false);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          aria-label="Open nearby players"
          className="mb-4 flex w-full items-center justify-between gap-3 rounded-3xl border border-border bg-surface/70 p-4 text-left transition-colors hover:border-lime/60"
        >
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold leading-tight">Nearby players</h2>
            <p className="truncate text-xs text-muted-foreground">
              {originLabel
                ? `Closest to ${originLabel}`
                : "Find teammates and competitors near you"}
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-lime px-3 py-1.5 text-xs font-semibold text-primary-foreground">
            {ranked.length > 0 ? `${ranked.length} near you` : "Explore"}
            <ChevronUp className="h-3.5 w-3.5" />
          </span>
        </button>
      </DrawerTrigger>

      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DrawerTitle className="font-display text-lg font-bold leading-tight">
                Nearby players
              </DrawerTitle>
              <DrawerDescription className="truncate text-xs">
                {originLabel
                  ? `Closest to ${originLabel}`
                  : "Turn on location to find teammates and competitors near you"}
              </DrawerDescription>
            </div>
            {!coords && (
              <button
                onClick={request}
                disabled={status === "prompting"}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
              >
                {status === "prompting" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Navigation className="h-3.5 w-3.5 text-lime" />
                )}
                Use my location
              </button>
            )}
          </div>
        </DrawerHeader>

        <div className="overflow-y-auto px-4 pb-6">


      <div className="mt-3 flex gap-2">
        {RELATIONS.map((r) => {
          const active = relation === r.id;
          const Icon = r.icon;
          return (
            <button
              key={r.id}
              onClick={() => setRelation(r.id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? "border-lime bg-lime text-primary-foreground"
                  : "border-border bg-surface text-muted-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {r.label}
            </button>
          );
        })}
      </div>

      {status === "denied" && !origin && (
        <p className="mt-3 text-xs text-muted-foreground">
          Location is blocked.{" "}
          <Link to="/profile/edit" className="text-lime font-semibold">
            Set your city
          </Link>{" "}
          to see nearby players instead.
        </p>
      )}

      {!origin && status !== "denied" && (
        <p className="mt-3 text-xs text-muted-foreground">
          {originQuery.isLoading
            ? "Finding your area…"
            : "We’ll rank players by how far they are from you."}
        </p>
      )}

      {origin && (resolving ? (
        <p className="mt-3 text-xs text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Locating players…
        </p>
      ) : ranked.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No {relation === "all" ? "players" : relation} with a listed city yet. Try a wider
          sport filter.
        </p>
      ) : (
        <div className="-mx-4 mt-3 overflow-x-auto px-4">
          <div className="flex gap-3 pb-1">
            {ranked.map(({ player: p, km, shared }) => (
              <Link
                key={p.user_id}
                to="/players/$userId"
                params={{ userId: p.user_id }}
                onClick={() => setOpen(false)}
                className="w-40 shrink-0 rounded-2xl border border-border bg-surface p-3"
              >
                <UserAvatar
                  name={p.author_name}
                  initials={p.author_initials}
                  avatarUrl={p.author_avatar_url}
                  className="h-12 w-12 rounded-xl"
                />
                <h3 className="mt-2 truncate text-sm font-bold">{p.author_name}</h3>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span>{emojiBySport[p.sports?.[0] ?? ""] ?? "🧑"}</span>
                  <span className="truncate">{p.sports?.[0] ?? "Player"}</span>
                </div>
                {(() => {
                  // Profile tier first, post's own level as fallback.
                  const level = resolvePlayerLevel(
                    p.author_sport_levels,
                    p.sports?.[0] ?? null,
                    p.skill_level,
                  );
                  const text = formatSportLevel(level);
                  return text ? (
                    <span className="mt-1 inline-block rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
                      {text}
                    </span>
                  ) : null;
                })()}

                <div className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-lime">
                  <MapPin className="h-3 w-3" />
                  <Distance km={km} decimals={km < 10 ? 1 : 0} /> away
                </div>
                <span className="mt-1.5 inline-block rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                  {shared ? "Teammate" : "Competitor"}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
