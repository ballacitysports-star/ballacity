import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { searchPlayersForTeam } from "@/lib/team-roster.functions";
import {
  ASSIGNABLE_ROLES,
  ROLE_META,
  teamRosterErrorMessage,
  useTeamRosterActions,
  type TeamRole,
} from "@/lib/team-roster";

export function InvitePlayerDialog({
  teamId,
  teamName,
  open,
  onOpenChange,
}: {
  teamId: string;
  teamName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [role, setRole] = useState<TeamRole>("player");
  const [message, setMessage] = useState("");
  const search = useServerFn(searchPlayersForTeam);
  const { invite } = useTeamRosterActions(teamId);

  const term = q.trim();
  const results = useQuery({
    queryKey: ["team-invite-search", teamId, term],
    queryFn: () => search({ data: { teamId, q: term } }),
    enabled: open && term.length >= 2,
    staleTime: 10_000,
  });

  const sendInvite = (userId: string, name: string) => {
    invite.mutate(
      { userId, role, message: message.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`Invitation sent to ${name}`);
          setQ("");
          setMessage("");
          onOpenChange(false);
        },
        onError: (err) => toast.error(teamRosterErrorMessage(err)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a player</DialogTitle>
          <DialogDescription>
            They'll get an invitation to join {teamName} and can accept or decline.
          </DialogDescription>
        </DialogHeader>

        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">Role on the roster</div>
          <div className="flex flex-wrap gap-1.5">
            {ASSIGNABLE_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  role === r
                    ? "border-lime bg-lime text-primary-foreground"
                    : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {ROLE_META[r].emoji} {ROLE_META[r].label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{ROLE_META[role].blurb}</p>
        </div>

        <label className="relative mt-1 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search players by name or username"
            className="w-full rounded-2xl border border-border bg-surface py-2.5 pl-9 pr-3 text-sm outline-none focus:border-lime/50"
          />
        </label>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          maxLength={280}
          placeholder="Add a note (optional)"
          className="w-full rounded-2xl border border-border bg-surface p-3 text-sm outline-none focus:border-lime/50"
        />

        <div className="max-h-64 space-y-2 overflow-y-auto">
          {term.length < 2 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search.
            </p>
          )}
          {term.length >= 2 && results.isLoading && (
            <p className="py-6 text-center text-sm text-muted-foreground">Searching…</p>
          )}
          {term.length >= 2 && results.isError && (
            <p className="py-6 text-center text-sm text-coral">
              {teamRosterErrorMessage(results.error)}
            </p>
          )}
          {results.data?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No players found who can still be invited.
            </p>
          )}
          {(results.data ?? []).map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-2.5"
            >
              {p.avatarUrl ? (
                <img src={p.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
              ) : (
                <div className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-xs font-bold">
                  {p.avatarInitials ?? p.displayName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{p.displayName}</div>
                {p.username && (
                  <div className="truncate text-xs text-muted-foreground">@{p.username.replace(/^@/, "")}</div>
                )}
              </div>
              <button
                type="button"
                disabled={invite.isPending}
                onClick={() => sendInvite(p.id, p.displayName)}
                className="inline-flex items-center gap-1 rounded-full bg-lime-gradient px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60"
              >
                {invite.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5" />
                )}
                Invite
              </button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
