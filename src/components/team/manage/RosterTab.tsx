import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Hash, Loader2, MoreVertical, UserMinus, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { ConfirmAction } from "@/components/superadmin/ConfirmAction";
import { InvitePlayerDialog } from "@/components/team/InvitePlayerDialog";
import { MemberDetailsDialog } from "@/components/team/manage/MemberDetailsDialog";
import {
  ASSIGNABLE_ROLES,
  ROLE_META,
  teamRosterErrorMessage,
  useTeamPermissions,
  useTeamRoster,
  useTeamRosterActions,
  type RosterMember,
  type TeamRole,
} from "@/lib/team-roster";

function RoleChip({ role }: { role: TeamRole }) {
  return (
    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold">
      {ROLE_META[role].emoji} {ROLE_META[role].label}
    </span>
  );
}

export function RosterTab({ teamId, teamName }: { teamId: string; teamName: string }) {
  const perms = useTeamPermissions(teamId);
  const roster = useTeamRoster(teamId);
  const { removeMember, setRole } = useTeamRosterActions(teamId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<RosterMember | null>(null);
  const [removing, setRemoving] = useState<RosterMember | null>(null);

  const members = roster.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 section-eyebrow text-muted-foreground">
          <Users className="h-4 w-4" /> Roster · {members.length}
        </h2>
        {perms.canInvite && (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Invite
          </Button>
        )}
      </div>

      {roster.isLoading && (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading roster…
        </div>
      )}

      {!roster.isLoading && members.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-muted-foreground">
          No players on the roster yet. Invite your first player to get started.
        </div>
      )}

      <div className="space-y-2">
        {members.map((m) => {
          const isOwner = m.role === "owner";
          return (
            <div
              key={m.id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3"
            >
              <Link to="/player-card/$userId" params={{ userId: m.userId }} className="shrink-0">
                <UserAvatar
                  avatarUrl={m.avatarUrl}
                  initials={m.initials}
                  name={m.displayName}
                  size="md"
                />
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  to="/player-card/$userId"
                  params={{ userId: m.userId }}
                  className="block truncate text-sm font-semibold hover:text-lime"
                >
                  {m.displayName}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <RoleChip role={m.role} />
                  {m.jerseyNumber && <span>#{m.jerseyNumber}</span>}
                  {m.position && <span>{m.position}</span>}
                </div>
              </div>
              {perms.canRemoveMembers && !isOwner && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Manage ${m.displayName}`}
                    className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={() => setEditing(m)}>
                      <Hash className="mr-2 h-4 w-4" /> Number &amp; position
                    </DropdownMenuItem>
                    {perms.canAssignRoles && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Change role</DropdownMenuLabel>
                        {ASSIGNABLE_ROLES.filter((r) => r !== m.role).map((r) => (
                          <DropdownMenuItem
                            key={r}
                            onClick={() =>
                              setRole.mutate(
                                { userId: m.userId, role: r },
                                {
                                  onSuccess: () =>
                                    toast.success(
                                      `${m.displayName} is now ${ROLE_META[r].label.toLowerCase()}`,
                                    ),
                                  onError: (err) => toast.error(teamRosterErrorMessage(err)),
                                },
                              )
                            }
                          >
                            {ROLE_META[r].emoji} {ROLE_META[r].label}
                          </DropdownMenuItem>
                        ))}
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-coral" onClick={() => setRemoving(m)}>
                      <UserMinus className="mr-2 h-4 w-4" /> Remove from team
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
      </div>

      <InvitePlayerDialog
        teamId={teamId}
        teamName={teamName}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />

      <MemberDetailsDialog
        teamId={teamId}
        member={editing}
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
      />

      <ConfirmAction
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`Remove ${removing?.displayName ?? ""}?`}
        description="They lose access to anything shared with the team, including messages and media visible to teammates."
        confirmLabel="Remove"
        requireReason={false}
        pending={removeMember.isPending}
        onConfirm={() => {
          const target = removing;
          if (!target) return;
          removeMember.mutate(target.userId, {
            onSuccess: () => {
              toast.success(`${target.displayName} removed`);
              setRemoving(null);
            },
            onError: (err) => toast.error(teamRosterErrorMessage(err)),
          });
        }}
      />
    </div>
  );
}
