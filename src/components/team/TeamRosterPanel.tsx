import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Mail, MoreVertical, UserMinus, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InvitePlayerDialog } from "@/components/team/InvitePlayerDialog";
import {
  ASSIGNABLE_ROLES,
  ROLE_META,
  teamRosterErrorMessage,
  useTeamPendingInvites,
  useTeamPermissions,
  useTeamRoster,
  useTeamRosterActions,
  type RosterMember,
  type TeamRole,
} from "@/lib/team-roster";

function Avatar({
  member,
}: {
  member: { avatarUrl: string | null; initials: string | null; displayName: string };
}) {
  if (member.avatarUrl) {
    return <img src={member.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />;
  }
  return (
    <div className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-xs font-bold">
      {member.initials ?? member.displayName.slice(0, 2).toUpperCase()}
    </div>
  );
}

function RoleChip({ role }: { role: TeamRole }) {
  return (
    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold">
      {ROLE_META[role].emoji} {ROLE_META[role].label}
    </span>
  );
}

function MemberRow({
  teamId,
  member,
  canManage,
  canAssignRoles,
}: {
  teamId: string;
  member: RosterMember;
  canManage: boolean;
  canAssignRoles: boolean;
}) {
  const { removeMember, setRole } = useTeamRosterActions(teamId);
  const isOwner = member.role === "owner";
  const showMenu = canManage && !isOwner;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
      <Link to="/player-card/$userId" params={{ userId: member.userId }} className="shrink-0">
        <Avatar member={member} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          to="/player-card/$userId"
          params={{ userId: member.userId }}
          className="block truncate text-sm font-semibold hover:text-lime"
        >
          {member.displayName}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <RoleChip role={member.role} />
          {member.jerseyNumber && <span>#{member.jerseyNumber}</span>}
          {member.position && <span>{member.position}</span>}
        </div>
      </div>
      {showMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Manage ${member.displayName}`}
            className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground"
          >
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {canAssignRoles && (
              <>
                <DropdownMenuLabel>Change role</DropdownMenuLabel>
                {ASSIGNABLE_ROLES.filter((r) => r !== member.role).map((r) => (
                  <DropdownMenuItem
                    key={r}
                    onClick={() =>
                      setRole.mutate(
                        { userId: member.userId, role: r },
                        {
                          onSuccess: () =>
                            toast.success(
                              `${member.displayName} is now ${ROLE_META[r].label.toLowerCase()}`,
                            ),
                          onError: (err) => toast.error(teamRosterErrorMessage(err)),
                        },
                      )
                    }
                  >
                    {ROLE_META[r].emoji} {ROLE_META[r].label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              className="text-coral"
              onClick={() => {
                if (!confirm(`Remove ${member.displayName} from the roster?`)) return;
                removeMember.mutate(member.userId, {
                  onSuccess: () => toast.success(`${member.displayName} removed`),
                  onError: (err) => toast.error(teamRosterErrorMessage(err)),
                });
              }}
            >
              <UserMinus className="mr-2 h-4 w-4" /> Remove from team
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function TeamRosterPanel({ teamId, teamName }: { teamId: string; teamName: string }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const perms = useTeamPermissions(teamId);
  const roster = useTeamRoster(teamId);
  const invites = useTeamPendingInvites(teamId, perms.canInvite);
  const { cancelInvite } = useTeamRosterActions(teamId);

  const members = roster.data ?? [];

  return (
    <div className="mt-5 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
          <Users className="h-4 w-4" /> Roster · {members.length}
        </h2>
        {perms.canInvite && (
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-lime-gradient px-3 py-2 text-xs font-bold text-primary-foreground"
          >
            <UserPlus className="h-3.5 w-3.5" /> Invite
          </button>
        )}
      </div>

      {roster.isLoading && (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading roster…
        </div>
      )}

      {!roster.isLoading && members.length === 0 && (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          No players on the roster yet.
          {perms.canInvite && " Invite your first player to get started."}
        </div>
      )}

      <div className="space-y-2">
        {members.map((m) => (
          <MemberRow
            key={m.id}
            teamId={teamId}
            member={m}
            canManage={perms.canRemoveMembers}
            canAssignRoles={perms.canAssignRoles}
          />
        ))}
      </div>

      {perms.canInvite && (invites.data?.length ?? 0) > 0 && (
        <div>
          <h3 className="mb-2 inline-flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
            <Mail className="h-4 w-4" /> Pending invites · {invites.data!.length}
          </h3>
          <div className="space-y-2">
            {invites.data!.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-surface p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{inv.displayName}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <RoleChip role={inv.role} />
                    <span>invited · awaiting reply</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    cancelInvite.mutate(inv.id, {
                      onSuccess: () => toast.success("Invitation cancelled"),
                      onError: (err) => toast.error(teamRosterErrorMessage(err)),
                    })
                  }
                  className="rounded-full border border-border px-3 py-2 text-xs font-bold text-muted-foreground"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <InvitePlayerDialog
        teamId={teamId}
        teamName={teamName}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />
    </div>
  );
}
