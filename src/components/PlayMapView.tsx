import { MediaImage } from "@/components/MediaImage";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Navigation } from "lucide-react";
import { GAMES, SPORTS } from "@/lib/sample-data";
import { formatGameWhen } from "@/lib/format";
import { GamesMap, type MapPinItem } from "@/components/GamesMap";
import { useMyProfile } from "@/lib/user-prefs-store";
import { useHostedGames } from "@/lib/hosted-games-store";
import { useAuth } from "@/hooks/use-auth";
import { useLiveParticipantCount } from "@/lib/game-participants-store";
import { computeSpotsLeft } from "@/lib/spots-left";
import { SpotsPill } from "@/components/SpotsPill";
import { hideFinishedGames } from "@/lib/game-time";

const emojiBySport: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.name, s.emoji]),
);

// Deterministic pseudo-coordinate 0-100 derived from an id, so pins for
// entities without real lat/lng (players, teams) stay put across renders.
function pseudoCoord(id: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 90) + 5; // 5-95 to keep pins inside the visible box
}

export type MapItemLike = { id: string };

/**
 * Generic map surface. Feed uses it for games (default behavior when no
 * props are supplied). Players and Teams pages pass their own pins + card.
 */
export function PlayMapView<T extends MapItemLike>(props?: {
  items?: T[];
  pins?: MapPinItem[];
  renderCard?: (item: T) => ReactNode;
  noun?: string;
  emptyLabel?: string;
  /**
   * If provided, tapping the same pin twice (or tapping an already-active
   * pin) navigates to this destination. Filters on the current route stay in
   * the URL, so the back button restores them.
   */
  getHref?: (item: T) => { to: string; params?: Record<string, string> } | null;
  /**
   * Called with the items inside the current map viewport whenever the user
   * pans or zooms. Callers use it to prioritize loading (e.g. avatars) for
   * what is actually on screen.
   */
  onVisibleItemsChange?: (items: T[]) => void;
}) {
  const { user } = useAuth();
  const profile = useMyProfile(user);
  const hosted = useHostedGames();
  const navigate = useNavigate();

  // Default (games) behavior when caller supplies nothing.
  const defaultGames = useMemo(() => hideFinishedGames([...hosted, ...GAMES]), [hosted]);
  const items = (props?.items ?? (defaultGames as unknown as T[])) as T[];
  const noun = props?.noun ?? "game";
  const emptyLabel = props?.emptyLabel ?? `No ${noun}s in this area. Pan the map or reset.`;

  const pins: MapPinItem[] = useMemo(() => {
    if (props?.pins) return props.pins;
    // No explicit pins: derive them from the (already filtered/sorted) items.
    const games = items as unknown as Array<{
      id: string;
      sport: string;
      lat?: number | null;
      lng?: number | null;
      urgent?: boolean;
    }>;
    // Games whose venue was never geocoded have no coordinates — skip them
    // instead of dropping a pin at a placeholder location.
    return games
      .filter((g) => typeof g.lat === "number" && typeof g.lng === "number")
      .map((g) => ({
        id: g.id,
        emoji: emojiBySport[g.sport] ?? "📍",
        lat: g.lat as number,
        lng: g.lng as number,
        urgent: g.urgent,
      }));
  }, [props?.pins, items]);

  const [active, setActive] = useState<string>(items[0]?.id ?? "");
  const [visibleIds, setVisibleIds] = useState<string[] | null>(null);
  const visibleItems = useMemo(
    () => (visibleIds ? items.filter((it) => visibleIds.includes(it.id)) : items),
    [visibleIds, items],
  );
  const activeItem = visibleItems.find((it) => it.id === active) ?? visibleItems[0] ?? null;

  const onVisibleItemsChange = props?.onVisibleItemsChange;
  useEffect(() => {
    onVisibleItemsChange?.(visibleItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems]);

  const renderCard =
    props?.renderCard ?? ((item: T) => <DefaultGameCard game={item as unknown as ActiveGame} />);

  const lastTapRef = useRef<{ id: string; at: number } | null>(null);
  const handleSelect = (id: string) => {
    const now = Date.now();
    const last = lastTapRef.current;
    const isRetap = last && last.id === id && now - last.at < 1500;
    lastTapRef.current = { id, at: now };
    setActive(id);
    if (isRetap && props?.getHref) {
      const item = items.find((it) => it.id === id);
      const href = item ? props.getHref(item) : null;
      if (href) navigate({ to: href.to, params: href.params });
    }
  };

  return (
    <div className="relative h-[calc(100dvh-11rem)] overflow-hidden rounded-3xl border border-border">
      <GamesMap
        pins={pins}
        activeId={active}
        onSelect={handleSelect}

        defaultLocation={profile?.city}
        onVisibleChange={(ids) => {
          setVisibleIds(ids);
          if (ids.length && !ids.includes(active)) setActive(ids[0]);
        }}
      />

      <div className="absolute left-3 right-3 top-3 z-10">
        <div className="rounded-2xl border border-border bg-surface/80 backdrop-blur-xl p-3 shadow-xl">
          <div className="flex items-center gap-2 text-sm">
            <Navigation className="h-4 w-4 text-lime" />
            <span className="font-semibold">{visibleIds ? "This area" : "Live location"}</span>
            <span className="text-muted-foreground">
              · {visibleItems.length} {noun}
              {visibleItems.length === 1 ? "" : "s"} {visibleIds ? "in view" : "nearby"}
            </span>
            {visibleIds && (
              <button
                onClick={() => setVisibleIds(null)}
                className="ml-auto text-xs font-bold text-lime"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="absolute bottom-3 left-3 right-3 z-20">
        <AnimatePresence mode="wait">
          {activeItem ? (
            <motion.div
              key={activeItem.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              transition={{ type: "spring", stiffness: 240, damping: 24 }}
            >
              {renderCard(activeItem)}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              className="rounded-3xl border border-border bg-surface/90 backdrop-blur-xl p-4 text-center text-sm text-muted-foreground shadow-2xl"
            >
              {emptyLabel}{" "}
              <button onClick={() => setVisibleIds(null)} className="font-bold text-lime">
                reset
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

type ActiveGame = {
  id: string;
  image: string;
  sport: string;
  skill: string;
  title: string;
  location: string;
  date: string;
  maxPlayers: number;
  joined: number;
};

function DefaultGameCard({ game }: { game: ActiveGame }) {
  const liveCount = useLiveParticipantCount(game.id);
  const spotsLeft = computeSpotsLeft(game.maxPlayers, game.joined, liveCount);
  return (
    <Link
      to="/games/$gameId"
      params={{ gameId: game.id }}
      className="flex gap-3 rounded-3xl border border-border bg-surface/90 backdrop-blur-xl p-3 shadow-2xl"
    >
      <MediaImage
        src={game.image}
        alt=""
        loading="lazy"
        className="h-20 w-20 rounded-2xl object-cover"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs">
          <span>{emojiBySport[game.sport]}</span>
          <span className="font-semibold">{game.sport}</span>
          <span className="text-muted-foreground">· {game.skill}</span>
        </div>
        <h3 className="font-display text-base font-bold truncate">{game.title}</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <MapPin className="h-3.5 w-3.5" />
          <span className="truncate">{game.location}</span>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-xs">{formatGameWhen(game)}</span>
          <SpotsPill spotsLeft={spotsLeft} />
        </div>
      </div>
    </Link>
  );
}

// Exposed for other map views that want stable pseudo lat/lng from an id.
export function pseudoLatLngFromId(id: string): { lat: number; lng: number } {
  return { lat: pseudoCoord(id, 7), lng: pseudoCoord(id, 131) };
}
