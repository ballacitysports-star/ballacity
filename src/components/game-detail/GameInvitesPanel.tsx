import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Repeat, Send, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  createHostGroup,
  deleteHostGroup,
  groupNameError,
  listMyHostGroups,
  GROUP_NAME_MAX,
} from "@/lib/host-groups";
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
  listRegularPlayers,
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
  regularDetail,
  regularState,
  type CandidateState,
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
 * waits), and two ways to invite up to 30 at once: "Invite nearby" (players whose availability overlaps the game, near its
 * place, for its sport) and, from WP 3.2a, "Invite regulars" (adults who played in this host's games in the last 90 days).
 * Shown only to the host of an upcoming game. The database decides who can be invited and says so neutrally; this only
 * offers the people the host can already see.
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
  const [open, setOpen] = useState<null | "nearby" | "regulars">(null);
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
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button
            size="sm"
            className="rounded-full bg-lime-gradient text-primary-foreground"
            onClick={() => setOpen("nearby")}
            disabled={!search.ok}
          >
            <UserPlus className="mr-1 h-4 w-4" aria-hidden /> Invite nearby
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => setOpen("regulars")}
          >
            <Repeat className="mr-1 h-4 w-4" aria-hidden /> Invite regulars
          </Button>
        </div>
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
          open={open === "nearby"}
          onOpenChange={(o) => setOpen(o ? "nearby" : null)}
          game={game}
          query={search.query}
          hostId={hostId}
          rosterIds={rosterIds}
          invites={rows}
          onInvited={() => void qc.invalidateQueries({ queryKey: invitesKey })}
        />
      )}
      <InviteRegularsSheet
        open={open === "regulars"}
        onOpenChange={(o) => setOpen(o ? "regulars" : null)}
        game={game}
        hostId={hostId}
        rosterIds={rosterIds}
        invites={rows}
        onInvited={() => {
          void qc.invalidateQueries({ queryKey: invitesKey });
          void qc.invalidateQueries({ queryKey: ["invite-regulars", game.id] });
        }}
      />
    </section>
  );
}

type Candidate = { id: string; name: string; detail: string; state: CandidateState };

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
  const nearby = useQuery({
    queryKey: ["invite-candidates", game.id, query.from, query.to, query.sport],
    queryFn: () => listAvailabilityNear(query),
    enabled: open,
    staleTime: 30_000,
  });

  // One row per person: the search already returns one, the nearest first.
  const people = useMemo<Candidate[]>(() => {
    const seen = new Set<string>();
    return (nearby.data ?? [])
      .filter((p: NearbyAvailabilityWithAuthor) =>
        seen.has(p.user_id) ? false : (seen.add(p.user_id), true),
      )
      .map((p) => {
        const st = candidateState(p.user_id, { hostId, rosterIds, invites });
        return {
          id: p.user_id,
          name: p.author_name,
          detail: `${typeof p.distance_mi === "number" ? `${p.distance_mi} mi away` : ""}${
            p.skill_level ? ` · ${p.skill_level}` : ""
          }`,
          state: st === "host" ? "on_roster" : st,
        };
      })
      .filter((p) => p.id !== hostId);
  }, [nearby.data, hostId, rosterIds, invites]);

  return (
    <InvitePickerSheet
      open={open}
      onOpenChange={onOpenChange}
      game={game}
      title="Invite players nearby"
      description={`Players who said they're free for ${game.sport} at this game's time, within ${INVITE_SEARCH_RADIUS_MI} miles.`}
      listLabel="Available players"
      loadingText="Finding players…"
      emptyText="No one nearby has posted availability for this time yet."
      loading={nearby.isLoading}
      error={nearby.isError}
      people={people}
      onInvited={onInvited}
    />
  );
}

function InviteRegularsSheet({
  open,
  onOpenChange,
  game,
  hostId,
  rosterIds,
  invites,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  game: Game;
  hostId: string | null;
  rosterIds: readonly string[];
  invites: readonly GameInvite[];
  onInvited: () => void;
}) {
  const regulars = useQuery({
    queryKey: ["invite-regulars", game.id],
    queryFn: async () => {
      const rows = await listRegularPlayers(game.id);
      const names = await inviteeNames(rows.map((r) => r.user_id));
      return { rows, names };
    },
    enabled: open,
    staleTime: 30_000,
  });

  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ["host-groups"], queryFn: listMyHostGroups, enabled: open });
  const [groupId, setGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);
  const group = (groups.data ?? []).find((g) => g.id === groupId) ?? null;

  const allPeople = useMemo<Candidate[]>(
    () =>
      (regulars.data?.rows ?? []).map((r) => {
        // The server's answer, or what this page already knows (an invitation sent a moment ago).
        const local = candidateState(r.user_id, { hostId, rosterIds, invites });
        return {
          id: r.user_id,
          name: regulars.data?.names[r.user_id] ?? "Player",
          detail: regularDetail(r.games, r.last_played),
          state: regularState(r.status) ?? (local === "host" ? "on_roster" : local),
        };
      }),
    [regulars.data, hostId, rosterIds, invites],
  );
  // A group shows its members who are still regulars; anyone who is not (no game in 90 days, opted out, blocked) is left out.
  const people = group ? allPeople.filter((p) => group.memberIds.includes(p.id)) : allPeople;
  const missing = group
    ? group.memberIds.filter((id) => !allPeople.some((p) => p.id === id)).length
    : 0;

  const saveGroup = async (picked: string[], clear: () => void) => {
    const problem = groupNameError(groupName, groups.data ?? []);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSavingGroup(true);
    try {
      const id = await createHostGroup(groupName, picked);
      toast.success(
        `Saved “${groupName.trim()}” with ${picked.length} ${picked.length === 1 ? "player" : "players"}.`,
      );
      setGroupName("");
      clear();
      await qc.invalidateQueries({ queryKey: ["host-groups"] });
      setGroupId(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the group.");
    } finally {
      setSavingGroup(false);
    }
  };

  const removeGroup = async () => {
    if (!group) return;
    try {
      await deleteHostGroup(group.id);
      toast.success(`Deleted “${group.name}”.`);
      setGroupId(null);
      await qc.invalidateQueries({ queryKey: ["host-groups"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete the group.");
    }
  };

  const toolbar =
    (groups.data ?? []).length > 0 ? (
      <div className="space-y-1">
        <div role="group" aria-label="Your groups" className="flex flex-wrap gap-2">
          {[{ id: null as string | null, name: "All regulars" }, ...(groups.data ?? [])].map(
            (g) => (
              <button
                key={g.id ?? "all"}
                type="button"
                aria-pressed={groupId === g.id}
                onClick={() => setGroupId(g.id)}
                className={`min-h-9 rounded-full border px-3 text-[13px] font-semibold ${
                  groupId === g.id
                    ? "border-lime bg-lime/10 text-lime"
                    : "border-border text-muted-foreground"
                }`}
              >
                {g.name}
              </button>
            ),
          )}
        </div>
        {group && (
          <p className="text-xs text-muted-foreground">
            {missing > 0
              ? `${missing} ${missing === 1 ? "person" : "people"} in this group can't be invited right now. `
              : ""}
            <button
              type="button"
              onClick={() => void removeGroup()}
              className="font-semibold underline underline-offset-2"
            >
              Delete group
            </button>
          </p>
        )}
      </div>
    ) : null;

  return (
    <InvitePickerSheet
      open={open}
      onOpenChange={onOpenChange}
      game={game}
      toolbar={toolbar}
      renderExtra={(picked, clear) =>
        !group && picked.length > 0 ? (
          <div className="space-y-1">
            <label
              htmlFor="save-group-name"
              className="block text-xs font-bold uppercase text-muted-foreground"
            >
              Save these {picked.length} as a group (only you see it)
            </label>
            <div className="flex gap-2">
              <Input
                id="save-group-name"
                value={groupName}
                maxLength={GROUP_NAME_MAX}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Tuesday crew"
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0 rounded-full"
                disabled={savingGroup}
                onClick={() => void saveGroup(picked, clear)}
              >
                Save
              </Button>
            </div>
          </div>
        ) : null
      }
      title="Invite your regulars"
      description="Players from your games in the last 90 days. They don't need to have posted availability; they can turn this off in their privacy settings."
      listLabel="Your regulars"
      loadingText="Finding your regulars…"
      emptyText={
        group
          ? "No one in this group can be invited right now."
          : "No one has played in your games in the last 90 days yet."
      }
      loading={regulars.isLoading}
      error={regulars.isError}
      people={people}
      onInvited={onInvited}
    />
  );
}

function InvitePickerSheet({
  open,
  onOpenChange,
  game,
  title,
  description,
  listLabel,
  loadingText,
  emptyText,
  loading,
  error,
  people,
  onInvited,
  toolbar,
  renderExtra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  game: Game;
  toolbar?: ReactNode;
  renderExtra?: (picked: string[], clear: () => void) => ReactNode;
  title: string;
  description: string;
  listLabel: string;
  loadingText: string;
  emptyText: string;
  loading: boolean;
  error: boolean;
  people: readonly Candidate[];
  onInvited: () => void;
}) {
  const [pickedAll, setPicked] = useState<string[]>([]);
  // Only what is on screen counts (a host who switches group does not send to people they can no longer see).
  const picked = pickedAll.filter((id) => people.some((p) => p.id === id && p.state === null));
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const noteId = `invite-note-${listLabel.replace(/\W+/g, "-").toLowerCase()}`;

  const open_ = people.filter((p) => p.state === null);
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
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {toolbar}
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {loadingText}
            </p>
          ) : error ? (
            <p className="text-sm text-muted-foreground">
              Couldn't load players right now. Try again in a moment.
            </p>
          ) : people.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyText}</p>
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
                        : open_.slice(0, INVITE_BATCH_MAX).map((p) => p.id),
                    )
                  }
                >
                  {picked.length === Math.min(open_.length, INVITE_BATCH_MAX)
                    ? "Clear selection"
                    : "Select everyone available"}
                </button>
              )}
              <ul className="space-y-2" aria-label={listLabel}>
                {people.map((p) => {
                  const st = p.state;
                  const checked = picked.includes(p.id);
                  return (
                    <li key={p.id}>
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
                          onChange={() => toggle(p.id)}
                          aria-label={`Invite ${p.name}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{p.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {p.detail}
                          </span>
                        </span>
                        {st && (
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
                  htmlFor={noteId}
                  className="mb-1 block text-xs font-bold uppercase text-muted-foreground"
                >
                  Note (optional)
                </label>
                <Textarea
                  id={noteId}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Short a few players. Hope you can make it!"
                />
              </div>
            </>
          )}
          {renderExtra?.(picked, () => setPicked([]))}
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
