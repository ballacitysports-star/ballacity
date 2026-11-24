import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { safeTimezone } from "@/lib/availability-lifecycle";
import {
  acceptWaitsForGuardian,
  gameInviteErrorMessage,
  listMyPendingGameInvites,
  respondToGameInvite,
  saveDefaultRemindersOnAccept,
  type GameInviteWithGame,
} from "@/lib/game-invites";
import { inviteAcceptedMessage } from "@/lib/invite-accept-copy";

function when(date: string, tz: string | null): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: safeTimezone(tz),
  });
}

/**
 * WP 2.0: invitations to games waiting for the player's answer, newest first, with the real game from the server. Accept
 * approves their place and, on a free game with no guardian step, puts them on the roster (20261127120000); otherwise they
 * open the game to pay or to wait for their guardian. Renders nothing when there are none.
 */
export function GameInvitationsSection({
  userId,
  refreshKey,
}: {
  userId: string;
  refreshKey: number;
}) {
  const [rows, setRows] = useState<GameInviteWithGame[] | null>(null);
  const [accepted, setAccepted] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listMyPendingGameInvites(userId)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [userId, refreshKey]);

  const answer = async (row: GameInviteWithGame, accept: boolean) => {
    setBusy(row.id);
    try {
      const res = await respondToGameInvite(row.id, accept);
      if (res.status === "accepted") {
        setAccepted((a) => ({ ...a, [row.id]: row.game_id }));
        // Reminders as if they had joined from the game page; not awaited, and a failure never reaches the catch below.
        void saveDefaultRemindersOnAccept(row.game_id).catch(() => {});
        // A free game with no guardian step puts the player on the roster as they accept (20261127120000); otherwise a
        // payment or a guardian's approval is still to come on the game page. A place held for the guardian says so; the
        // words follow the check (two reads; it never throws) without holding the row busy.
        void acceptWaitsForGuardian(res, userId).then((waitsForGuardian) =>
          toast.success(inviteAcceptedMessage(res, { waitsForGuardian, where: "list" })),
        );
      } else if (res.status === "full") {
        toast.error("This game is full right now. Your invitation stays open.");
        return;
      } else {
        toast.success(
          res.status === "declined" ? "Invitation declined" : "This invitation has ended",
        );
      }
      if (res.status !== "accepted") setRows((r) => (r ?? []).filter((x) => x.id !== row.id));
    } catch (e) {
      toast.error(gameInviteErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!rows || rows.length === 0) return null;

  return (
    <section aria-label="Game invitations">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
        Game invitations
      </h2>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="rounded-2xl border border-lime/30 bg-surface p-3 text-sm"
            data-testid="game-invitation"
          >
            <p className="font-semibold">{r.game?.title ?? "A game"}</p>
            {r.game && (
              <p className="text-xs text-muted-foreground">
                {r.game.sport} · {when(r.game.date, r.game.timezone)}
                {r.game.location ? ` · ${r.game.location}` : ""}
              </p>
            )}
            {r.message && <p className="mt-1">“{r.message}”</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {accepted[r.id] ? (
                <Link
                  to="/games/$gameId"
                  params={{ gameId: accepted[r.id] }}
                  className="inline-flex min-h-11 items-center rounded-full bg-lime-gradient px-4 text-xs font-bold text-primary-foreground"
                >
                  Open the game
                </Link>
              ) : (
                <>
                  <Button
                    size="sm"
                    className="min-h-11 rounded-full bg-lime-gradient px-4 text-primary-foreground"
                    disabled={busy === r.id}
                    onClick={() => void answer(r, true)}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 rounded-full px-4"
                    disabled={busy === r.id}
                    onClick={() => void answer(r, false)}
                  >
                    Decline
                  </Button>
                  <Link
                    to="/games/$gameId"
                    params={{ gameId: r.game_id }}
                    className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-lime"
                  >
                    See the game
                  </Link>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
