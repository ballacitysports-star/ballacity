import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { listAvailabilityNear, type NearbyAvailabilityWithAuthor } from "@/lib/availability";
import {
  cancelGameInvite,
  gameInviteErrorMessage,
  inviteeNames,
  invitePlayersToGame,
  listGameInvitesForGame,
  type GameInvite,
} from "@/lib/game-invites";
import {
  CANDIDATE_LABEL,
  INVITE_BATCH_MAX,
  INVITE_SEARCH_RADIUS_MI,
  bulkInviteMessage,
  candidateState,
  inviteCounts,
  inviteSearchFor,
} from "@/lib/host-invites";
import type { Game } from "@/lib/sample-data";

const STATUS_LABEL: Record<GameInvite["status"], string> = {
  pending: "Waiting",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Withdrawn",
  expired: "Ended",
};

/**
 * WP 2.1: the host's invitations for one game. A summary line, the invited players with their answers (Withdraw while one
 * waits), and "Invite players nearby": players whose availability overlaps the game, near its place, for its sport, to invite
 * up to 30 at once. Shown only to the host of an upcoming game. The database decides who can be invited and says so
 * neutrally; this only offers the people the host can already see in Find Players.
 */
export function GameInvitesPanel({
  game,
  hostId,
  rosterIds,
}: {
  game: Game;
  hostId: string | null;
  rosterIds: readonly string[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const search = useMemo(() => inviteSearchFor(game), [game]);

  const invitesKey = ["game-invites", game.id];
  const invites = useQuery({
    queryKey: invitesKey,
    queryFn: async () => {
      const rows = await listGameInvitesForGame(game.id);
      const names = await inviteeNames(rows.map((r) => r.invitee_id));
      return { rows, names };
    },
    staleTime: 15_000,
  });

  if (!search.ok && search.reason === "finished") return null;

  const rows = invites.data?.rows ?? [];
  const names = invites.data?.names ?? {};
  const counts = inviteCounts(rows);
  const visible = showAll ? rows : rows.slice(0, 5);

  const withdraw = async (inv: GameInvite) => {
    setBusy(inv.id);
    try {
      await cancelGameInvite(inv.id);
      toast.success("Invitation withdrawn");
      await qc.invalidateQueries({ queryKey: invitesKey });
    } catch (e) {
      toast.error(gameInviteErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const summary =
    rows.length === 0
      ? "No one invited yet."
      : [
          counts.pending && `${counts.pending} waiting`,
          counts.accepted && `${counts.accepted} accepted`,
          counts.declined && `${counts.declined} declined`,
        ]
          .filter(Boolean)
          .join(" · ") || `${rows.length} invited`;

  return (
    <section
      aria-label="Invited players"
      className="rounded-3xl border border-border bg-surface p-4"
      data-testid="game-invites-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="section-eyebrow text-muted-foreground">Invite players</h2>
          <p className="mt-1 text-sm">{summary}</p>
        </div>
        <Button
          size="sm"
          className="shrink-0 rounded-full bg-lime-gradient text-primary-foreground"
          onClick={() => setOpen(true)}
          disabled={!search.ok}
        >
          <UserPlus className="mr-1 h-4 w-4" aria-hidden /> Invite nearby
        </Button>
      </div>
      {!search.ok && search.reason === "no_location" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Add the game's address to find players available near it.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {visible.map((inv) => (
            <li
              key={inv.id}
              className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-border px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate font-semibold">
                {names[inv.invitee_id] ?? "Player"}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={`text-[11px] font-bold uppercase ${
                    inv.status === "accepted"
                      ? "text-lime"
                      : inv.status === "pending"
                        ? "text-foreground"
                        : "text-muted-foreground"
                  }`}
                >
                  {STATUS_LABEL[inv.status]}
                </span>
                {inv.status === "pending" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-full px-3 text-xs"
                    disabled={busy === inv.id}
                    onClick={() => void withdraw(inv)}
                  >
                    Withdraw
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 5 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 min-h-9 text-xs font-semibold text-lime"
        >
          {showAll ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}

      {search.ok && (
        <InviteNearbySheet
          open={open}
          onOpenChange={setOpen}
          game={game}
          query={search.query}
          hostId={hostId}
          rosterIds={rosterIds}
          invites={rows}
          onInvited={() => void qc.invalidateQueries({ queryKey: invitesKey })}
        />
      )}
    </section>
  );
}

function InviteNearbySheet({
  open,
  onOpenChange,
  game,
  query,
  hostId,
  rosterIds,
  invites,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  game: Game;
  query: Parameters<typeof listAvailabilityNear>[0];
  hostId: string | null;
  rosterIds: readonly string[];
  invites: readonly GameInvite[];
  onInvited: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const nearby = useQuery({
    queryKey: ["invite-candidates", game.id, query.from, query.to, query.sport],
    queryFn: () => listAvailabilityNear(query),
    enabled: open,
    staleTime: 30_000,
  });

  // One row per person: the search already returns one, the nearest first.
  const people = useMemo(() => {
    const seen = new Set<string>();
    return (nearby.data ?? []).filter((p: NearbyAvailabilityWithAuthor) =>
      seen.has(p.user_id) ? false : (seen.add(p.user_id), true),
    );
  }, [nearby.data]);
  const states = useMemo(
    () =>
      Object.fromEntries(
        people.map((p) => [p.user_id, candidateState(p.user_id, { hostId, rosterIds, invites })]),
      ),
    [people, hostId, rosterIds, invites],
  );
  const open_ = people.filter((p) => states[p.user_id] === null);
  const toggle = (id: string) =>
    setPicked((cur) =>
      cur.includes(id)
        ? cur.filter((x) => x !== id)
        : cur.length >= INVITE_BATCH_MAX
          ? cur
          : [...cur, id],
    );

  const send = async () => {
    if (picked.length === 0) return;
    setSending(true);
    try {
      const res = await invitePlayersToGame(game.id, picked, note);
      toast.success(bulkInviteMessage(res));
      setPicked([]);
      setNote("");
      onInvited();
      onOpenChange(false);
    } catch (e) {
      toast.error(gameInviteErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-3xl pb-8">
        <SheetHeader className="text-left">
          <SheetTitle>Invite players nearby</SheetTitle>
          <SheetDescription>
            Players who said they're free for {game.sport} at this game's time, within{" "}
            {INVITE_SEARCH_RADIUS_MI} miles.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {nearby.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Finding players…
            </p>
          ) : nearby.isError ? (
            <p className="text-sm text-muted-foreground">
              Couldn't load players right now. Try again in a moment.
            </p>
          ) : people.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No one nearby has posted availability for this time yet.
            </p>
          ) : (
            <>
              {open_.length > 1 && (
                <button
                  type="button"
                  className="min-h-9 text-xs font-semibold text-lime"
                  onClick={() =>
                    setPicked(
                      picked.length === Math.min(open_.length, INVITE_BATCH_MAX)
                        ? []
                        : open_.slice(0, INVITE_BATCH_MAX).map((p) => p.user_id),
                    )
                  }
                >
                  {picked.length === Math.min(open_.length, INVITE_BATCH_MAX)
                    ? "Clear selection"
                    : "Select everyone available"}
                </button>
              )}
              <ul className="space-y-2" aria-label="Available players">
                {people.map((p) => {
                  const st = states[p.user_id];
                  const checked = picked.includes(p.user_id);
                  return (
                    <li key={p.user_id}>
                      <label
                        className={`flex min-h-12 items-center gap-3 rounded-2xl border p-3 ${
                          st ? "opacity-60" : "cursor-pointer"
                        } ${checked ? "border-lime bg-lime/10" : "border-border"}`}
                      >
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-lime"
                          checked={checked}
                          disabled={!!st}
                          onChange={() => toggle(p.user_id)}
                          aria-label={`Invite ${p.author_name}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {p.author_name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {typeof p.distance_mi === "number" ? `${p.distance_mi} mi away` : ""}
                            {p.skill_level ? ` · ${p.skill_level}` : ""}
                          </span>
                        </span>
                        {st && st !== "host" && (
                          <span className="shrink-0 text-[11px] font-bold uppercase text-muted-foreground">
                            {CANDIDATE_LABEL[st]}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div>
                <label
                  htmlFor="invite-note"
                  className="mb-1 block text-xs font-bold uppercase text-muted-foreground"
                >
                  Note (optional)
                </label>
                <Textarea
                  id="invite-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Short a few players. Hope you can make it!"
                />
              </div>
            </>
          )}
          <Button
            className="h-12 w-full rounded-full bg-lime-gradient text-base font-bold text-primary-foreground"
            disabled={sending || picked.length === 0}
            onClick={() => void send()}
          >
            {sending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="mr-1 h-4 w-4" aria-hidden />
            )}
            {picked.length === 0
              ? "Pick players to invite"
              : `Invite ${picked.length} ${picked.length === 1 ? "player" : "players"}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
