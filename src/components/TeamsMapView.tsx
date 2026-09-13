import { Link } from "@tanstack/react-router";
import { MapPin, Users, GraduationCap } from "lucide-react";
import { PlayMapView, pseudoLatLngFromId } from "@/components/PlayMapView";
import type { MapPinItem } from "@/components/GamesMap";
import type { Org, OrgKind } from "@/lib/sample-data";
import { SPORTS } from "@/lib/sample-data";

const emojiBySport: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.name, s.emoji]),
);

export function TeamsMapView({ orgs, kind }: { orgs: Org[]; kind: OrgKind }) {
  const pins: MapPinItem[] = orgs.map((o) => {
    // Prefer real coordinates from the trainer's primary/first verified venue.
    const primaryKey = o.primaryVenue?.trim().toLowerCase();
    const geoList = o.venueGeo ?? [];
    const primary = primaryKey
      ? geoList.find((g) => g.address.trim().toLowerCase() === primaryKey)
      : undefined;
    const chosen = primary ?? geoList[0];
    const emoji = emojiBySport[o.sports?.[0] ?? ""] ?? (kind === "coach" ? "🎓" : "🛡️");
    if (chosen) {
      return { id: o.id, emoji, lat: chosen.lat, lng: chosen.lng, real: true };
    }
    const { lat, lng } = pseudoLatLngFromId(o.id);
    return { id: o.id, emoji, lat, lng };
  });

  const noun = kind === "coach" ? "trainer" : "team";
  const Icon = kind === "coach" ? GraduationCap : Users;

  return (
    <PlayMapView<Org>
      items={orgs}
      pins={pins}
      noun={noun}
      emptyLabel={`No ${noun}s in this area.`}
      getHref={(o) =>
        o.kind === "coach"
          ? { to: "/trainers/$trainerId", params: { trainerId: o.id } as Record<string, string> }
          : { to: "/teams/$teamId", params: { teamId: o.id } as Record<string, string> }
      }

      renderCard={(o) => (
        <Link
          to={o.kind === "coach" ? "/trainers/$trainerId" : "/teams/$teamId"}
          params={o.kind === "coach" ? { trainerId: o.id } : { teamId: o.id }}
          className="flex gap-3 rounded-3xl border border-border bg-surface/90 backdrop-blur-xl p-3 shadow-2xl"
        >
          <img src={o.cover} alt="" loading="lazy" className="h-20 w-20 rounded-2xl object-cover" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs">
              <Icon className="h-3.5 w-3.5 text-lime" strokeWidth={2.5} />
              <span className="font-semibold">
                {o.sports?.[0] ?? (kind === "coach" ? "Trainer" : "Team")}
              </span>
              {o.verified && <span className="text-muted-foreground">· Verified</span>}
            </div>
            <h3 className="font-display text-base font-bold truncate">{o.name}</h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <MapPin className="h-3.5 w-3.5" />
              <span className="truncate">{o.city}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-1">{o.tagline}</p>
          </div>
        </Link>
      )}
    />
  );
}
