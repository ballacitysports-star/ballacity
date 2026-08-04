import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CalendarPlus, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHostedGames } from "@/lib/hosted-games-store";
import { SPORTS, type Game } from "@/lib/sample-data";

/** Games this player hosts that are still joinable (started < 3h ago or later). */
export function useUpcomingGamesByHost(hostUserId: string): Game[] {
  const hosted = useHostedGames();
  return useMemo(() => {
    const cutoff = Date.now() - 3 * 60 * 60 * 1000;
    return hosted
      .filter(
        (g) =>
          g.hostUserId === hostUserId &&
          new Date(g.date).getTime() > cutoff &&
          g.status !== "completed",
      )
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [hosted, hostUserId]);
}

function gameWhen(g: Game) {
  const d = new Date(g.date);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Quick "Request to join" action for a player card: jumps straight into the
 * join flow on that player's game. One game goes there directly; several open
 * a picker first.
 */
export function RequestToJoinButton({
  hostUserId,
  hostName,
  size = "sm",
  className = "",
  variant = "outline",
  onNavigate,
}: {
  hostUserId: string;
  hostName: string;
  size?: "sm" | "default";
  className?: string;
  variant?: "outline" | "default";
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const games = useUpcomingGamesByHost(hostUserId);
  const [pickOpen, setPickOpen] = useState(false);

  const go = (gameId: string) => {
    setPickOpen(false);
    onNavigate?.();
    navigate({ to: "/games/$gameId", params: { gameId } });
  };

  const handleClick = () => {
    if (games.length === 0) {
      toast.info(`${hostName} isn't hosting a game yet`, {
        description: "Browse open pickup games instead.",
        action: {
          label: "Find a game",
          onClick: () => {
            onNavigate?.();
            navigate({ to: "/pickup" });
          },
        },
      });
      return;
    }
    if (games.length === 1) {
      go(games[0].id);
      return;
    }
    setPickOpen(true);
  };

  return (
    <>
      <Button
        size={size}
        variant={variant}
        onClick={handleClick}
        className={`rounded-full ${className}`}
      >
        <CalendarPlus className="h-4 w-4 mr-1" /> Request to join
      </Button>

      {pickOpen && (
        <Dialog open onOpenChange={(o) => !o && setPickOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Join a game with {hostName}</DialogTitle>
              <DialogDescription>
                Pick an event to open its join flow.
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-2">
              {games.map((g) => {
                const emoji = SPORTS.find((s) => s.name === g.sport)?.emoji ?? "🎯";
                return (
                  <li key={g.id}>
                    <button
                      onClick={() => go(g.id)}
                      className="w-full rounded-xl border border-border bg-surface p-3 text-left hover:border-lime/50"
                    >
                      <p className="truncate text-sm font-semibold">
                        {emoji} {g.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{gameWhen(g)}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" /> {g.location}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
