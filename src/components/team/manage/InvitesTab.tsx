import { useState } from "react";
import { Clock, Loader2, Mail, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { InvitePlayerDialog } from "@/components/team/InvitePlayerDialog";
import { formatCountdown } from "@/lib/datetime";
import {
  ROLE_META,
  teamRosterErrorMessage,
  useTeamPendingInvites,
  useTeamPermissions,
  useTeamRosterActions,
} from "@/lib/team-roster";

export function InvitesTab({ teamId, teamName }: { teamId: string; teamName: string }) {
  const perms = useTeamPermissions(teamId);
  const invites = useTeamPendingInvites(teamId, perms.canInvite);
  const { cancelInvite } = useTeamRosterActions(teamId);
  const [inviteOpen, setInviteOpen] = useState(false);

  const rows = invites.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 section-eyebrow text-muted-foreground">
          <Mail className="h-4 w-4" /> Pending · {rows.length}
        </h2>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Invite
        </Button>
      </div>

      {invites.isLoading && (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading invitations…
        </div>
      )}

      {!invites.isLoading && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-muted-foreground">
          No invitations waiting for a reply.
        </div>
      )}

      <div className="space-y-2">
        {rows.map((inv) => {
          const left = formatCountdown(inv.expiresAt);
          return (
            <div
              key={inv.id}
              className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-surface p-3"
            >
              <UserAvatar
                avatarUrl={inv.avatarUrl ?? null}
                name={inv.displayName ?? "Player"}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{inv.displayName}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold">
                    {ROLE_META[inv.role].emoji} {ROLE_META[inv.role].label}
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    <Clock className="h-3 w-3" />
                    {left ? `expires in ${left}` : "expired"}
                  </span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  cancelInvite.mutate(inv.id, {
                    onSuccess: () => toast.success("Invitation cancelled"),
                    onError: (err) => toast.error(teamRosterErrorMessage(err)),
                  })
                }
              >
                Cancel
              </Button>
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
    </div>
  );
}
