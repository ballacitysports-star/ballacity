import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { PlayMapView, pseudoLatLngFromId } from "@/components/PlayMapView";
import type { MapPinItem } from "@/components/GamesMap";
import { UserAvatar } from "@/components/UserAvatar";
import type { AvailabilityWithAuthor } from "@/lib/availability";
import { SPORTS } from "@/lib/sample-data";

const emojiBySport: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.name, s.emoji]),
);

export function PlayersMapView({ players }: { players: AvailabilityWithAuthor[] }) {
  const pins: MapPinItem[] = players.map((p) => {
    const { lat, lng } = pseudoLatLngFromId(p.user_id);
    return {
      id: p.id,
      emoji: emojiBySport[p.sports?.[0] ?? ""] ?? "🧑",
      lat,
      lng,
    };
  });

  return (
    <PlayMapView<AvailabilityWithAuthor>
      items={players}
      pins={pins}
      noun="player"
      emptyLabel="No players in this area."
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
