import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlayMapView, pseudoLatLngFromId } from "@/components/PlayMapView";
import type { MapPinItem } from "@/components/GamesMap";
import { UserAvatar } from "@/components/UserAvatar";
import { prefetchUserAvatars, usePrefetchUserAvatars } from "@/lib/user-avatars";

import type { AvailabilityWithAuthor } from "@/lib/availability";
import { SPORTS } from "@/lib/sample-data";
import { geocodeAddress } from "@/lib/geocode.functions";

const emojiBySport: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.name, s.emoji]),
);

export function PlayersMapView({ players }: { players: AvailabilityWithAuthor[] }) {
  const geocode = useServerFn(geocodeAddress);

  // Collect unique city strings we need to resolve to lat/lng.
  const uniqueCities = useMemo(() => {
    const set = new Set<string>();
    players.forEach((p) => {
      const c = p.city?.trim();
      if (c) set.add(c);
    });
    return Array.from(set);
  }, [players]);

  const cityQueries = useQueries({
    queries: uniqueCities.map((city) => ({
      queryKey: ["geocode-city", city.toLowerCase()],
      queryFn: () => geocode({ data: { address: city } }),
      staleTime: 24 * 60 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
    })),
  });

  const cityCoords = useMemo(() => {
    const map = new Map<string, { lat: number; lng: number }>();
    uniqueCities.forEach((city, i) => {
      const q = cityQueries[i];
      if (q?.data) map.set(city.toLowerCase(), { lat: q.data.lat, lng: q.data.lng });
    });
    return map;
  }, [uniqueCities, cityQueries]);

  const pins: MapPinItem[] = players.map((p) => {
    const emoji = emojiBySport[p.sports?.[0] ?? ""] ?? "🧑";
    const cityKey = p.city?.trim().toLowerCase();
    const real = cityKey ? cityCoords.get(cityKey) : undefined;
    if (real) {
      return { id: p.id, emoji, lat: real.lat, lng: real.lng, real: true };
    }
    const { lat, lng } = pseudoLatLngFromId(p.user_id);
    return { id: p.id, emoji, lat, lng };
  });

  // Everyone plotted on the map is a candidate, but the people inside the
  // current viewport get their photos first so cards feel instant while panning.
  usePrefetchUserAvatars(
    players.map((p) => p.user_id),
    "low",
  );

  return (
    <PlayMapView<AvailabilityWithAuthor>
      items={players}
      pins={pins}
      noun="player"
      emptyLabel="No players in this area."
      onVisibleItemsChange={(visible) =>
        prefetchUserAvatars(
          visible.map((p) => p.user_id),
          "high",
        )
      }

      renderCard={(p) => (
        <Link
          to="/players/$userId"
          params={{ userId: p.user_id }}
          className="flex gap-3 rounded-3xl border border-border bg-surface/90 backdrop-blur-xl p-3 shadow-2xl"
        >
          <UserAvatar
            name={p.author_name}
            initials={p.author_initials}
            avatarUrl={p.author_avatar_url}
            className="h-20 w-20 rounded-2xl"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs">
              <span>{emojiBySport[p.sports?.[0] ?? ""] ?? "🧑"}</span>
              <span className="font-semibold">{p.sports?.[0] ?? "Player"}</span>
              <span className="text-muted-foreground">· {p.skill_level}</span>
            </div>
            <h3 className="font-display text-base font-bold truncate">
              {p.author_name}
            </h3>
            {p.city && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                <MapPin className="h-3.5 w-3.5" />
                <span className="truncate">{p.city}</span>
              </div>
            )}
            {p.note && (
              <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                {p.note}
              </p>
            )}
          </div>
        </Link>
      )}
    />
  );
}
