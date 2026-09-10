import { useState } from "react";
import { Crown, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { ConfirmAction } from "@/components/superadmin/ConfirmAction";
import {
  teamRosterErrorMessage,
  useTeamPermissions,
  useTeamRoster,
  useTransferTeamOwnership,
  type RosterMember,
} from "@/lib/team-roster";

export function SettingsTab({ teamId, teamName }: { teamId: string; teamName: string }) {
  const perms = useTeamPermissions(teamId);
  const roster = useTeamRoster(teamId);
  const transfer = useTransferTeamOwnership(teamId);
  const [target, setTarget] = useState<RosterMember | null>(null);

  const members = roster.data ?? [];
  const owner = members.find((m) => m.role === "owner");
  const managers = members.filter((m) => m.role === "manager");
  const isOwner = perms.role === "owner";

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <h2 className="inline-flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
          <Crown className="h-4 w-4" /> Ownership
        </h2>
        {owner ? (
          <div className="flex items-center gap-3">
            <UserAvatar
              avatarUrl={owner.avatarUrl}
              initials={owner.initials}
              name={owner.displayName}
              size="md"
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{owner.displayName}</div>
              <div className="text-xs text-muted-foreground">Owner of {teamName}</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">This team has no owner on its roster.</p>
        )}
      </section>

      {isOwner && (
        <section className="space-y-3 rounded-2xl border border-coral/40 bg-surface p-4">
          <h2 className="inline-flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-coral">
            <ShieldAlert className="h-4 w-4" /> Hand over the team
          </h2>
          <p className="text-sm text-muted-foreground">
            The new owner takes full control, including the ability to delete the team. You stay on
            the roster as a manager. This cannot be undone from your side — only the new owner can
            hand it back.
          </p>

          {managers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-surface/40 p-3 text-sm text-muted-foreground">
              A team can only be handed to a manager, and this team has none yet. Promote someone on
              the Roster tab first.
            </p>
          ) : (
            <div className="space-y-2">
              {managers.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-xl border border-border p-3"
                >
                  <UserAvatar
                    avatarUrl={m.avatarUrl}
                    initials={m.initials}
                    name={m.displayName}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {m.displayName}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setTarget(m)}>
                    Make owner
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <ConfirmAction
        open={!!target}
        onOpenChange={(v) => !v && setTarget(null)}
        title={`Hand ${teamName} to ${target?.displayName ?? ""}?`}
        description="They become the owner and you become a manager. Only they can hand it back."
        confirmWord="TRANSFER"
        requireReason={false}
        confirmLabel="Transfer ownership"
        pending={transfer.isPending}
        onConfirm={() => {
          const to = target;
          if (!to) return;
          transfer.mutate(to.userId, {
            onSuccess: () => {
              toast.success(`${to.displayName} now owns ${teamName}`);
              setTarget(null);
            },
            onError: (err) => toast.error(teamRosterErrorMessage(err)),
          });
        }}
      />
    </div>
  );
}
