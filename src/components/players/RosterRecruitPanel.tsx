import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { InviteToTeamDialog, useMyRecruitingTeams } from "@/components/players/InviteToTeamDialog";
import type { LiveParticipant } from "@/lib/game-roster";

/**
 * Pickup roster → team recruiting. Team leaders (owner / manager / coach of at
 * least one team) can invite players they just ran with. `team_invite_player`
 * re-checks manager rights, blocks and existing membership, and routes minors
 * through their guardians, so this panel only decides visibility.
 */
export function RosterRecruitPanel({
  roster,
  meId,
}: {
  roster: Pick<LiveParticipant, "userId" | "displayName" | "avatarInitials">[];
  meId: string | null;
}) {
  const { teams } = useMyRecruitingTeams();
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const others = roster.filter((p) => p.userId !== meId);
  if (teams.length === 0 || others.length === 0) return null;

  return (
    <div className="mt-4 rounded-2xl border border-border/60 bg-surface p-3">
      <h3 className="section-eyebrow mb-2 flex items-center gap-1.5 text-muted-foreground">
        <UserPlus className="h-4 w-4" /> Scout this run
      </h3>
      <ul className="space-y-1.5">
        {others.map((p) => (
          <li key={p.userId} className="flex items-center justify-between gap-2">
            <Link
              to="/players/$userId"
              params={{ userId: p.userId }}
              className="min-w-0 truncate text-sm font-semibold hover:text-lime"
            >
              {p.displayName || p.avatarInitials}
            </Link>
            <button
              type="button"
              onClick={() => setTarget({ id: p.userId, name: p.displayName || "this player" })}
              aria-label={`Invite ${p.displayName || "player"} to your team`}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-lime/40 bg-lime/10 px-3 py-1 text-xs font-bold text-lime hover:bg-lime/20"
            >
              <UserPlus className="h-3.5 w-3.5" /> Invite to team
            </button>
          </li>
        ))}
      </ul>
      {target && (
        <InviteToTeamDialog
          playerId={target.id}
          playerName={target.name}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
