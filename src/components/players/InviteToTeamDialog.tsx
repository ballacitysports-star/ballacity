import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Shield } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  ASSIGNABLE_ROLES,
  MANAGER_ROLES,
  ROLE_META,
  teamRosterErrorMessage,
  useMyTeamMemberships,
  type TeamRole,
} from "@/lib/team-roster";

/** Teams the viewer can recruit for (owner / manager / coach). */
export function useMyRecruitingTeams() {
  const q = useMyTeamMemberships();
  const teams = (q.data ?? []).filter((t) => (MANAGER_ROLES as readonly string[]).includes(t.role));
  return { teams, isLoading: q.isLoading };
}

/**
 * Lets a team leader invite an available player to one of their teams.
 * The invite goes through the same server-side flow as the roster's Invite
 * button, so minors still need guardian approval and waivers before joining.
 */
export function InviteToTeamDialog({
  playerId,
  playerName,
  onClose,
}: {
  playerId: string;
  playerName: string;
  onClose: () => void;
}) {
  const { teams } = useMyRecruitingTeams();
  const [teamId, setTeamId] = useState(teams[0]?.teamId ?? "");
  const [role, setRole] = useState<TeamRole>("player");
  const [message, setMessage] = useState("");
  const qc = useQueryClient();

  const send = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)("team_invite_player", {
        _team: teamId,
        _user: playerId,
        _role: role,
        _message: message.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-invites"] });
      toast.success(`Team invite sent to ${playerName}`);
      onClose();
    },
    onError: (err) => toast.error(teamRosterErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite {playerName} to your team</DialogTitle>
          <DialogDescription>
            They can accept or decline. Players under 18 need a parent's approval first.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">Team</div>
          {teams.map((t) => (
            <button
              key={t.teamId}
              type="button"
              onClick={() => setTeamId(t.teamId)}
              className={`flex w-full items-center gap-2 rounded-2xl border p-3 text-left text-sm ${
                teamId === t.teamId ? "border-lime bg-lime/10" : "border-border bg-surface"
              }`}
            >
              <Shield className="h-4 w-4 text-lime" />
              <span className="flex-1 truncate font-semibold">{t.name}</span>
              <span className="text-xs text-muted-foreground">{ROLE_META[t.role].label}</span>
            </button>
          ))}
        </div>

        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted-foreground">Role</div>
          <div className="flex flex-wrap gap-1.5">
            {ASSIGNABLE_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  role === r
                    ? "border-lime bg-lime text-primary-foreground"
                    : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {ROLE_META[r].emoji} {ROLE_META[r].label}
              </button>
            ))}
          </div>
        </div>

        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 500))}
          placeholder="Add a short note about your team (optional)"
          rows={3}
        />

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!teamId || send.isPending} onClick={() => send.mutate()}>
            {send.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Send team invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
