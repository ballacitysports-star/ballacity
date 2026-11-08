import { useEffect, useState } from "react";
import { FollowEntityButton } from "@/components/FollowEntityButton";
import { TrainerActions } from "@/components/TrainerActions";
import { GuardianTeamContactAction } from "@/components/team/GuardianTeamContactAction";
import { isMyOrg, isOrgUnclaimed } from "@/lib/org-store";
import type { Org } from "@/lib/sample-data";

/**
 * P2-5: act on a team or trainer straight from Discover, without opening its page.
 *   * Follow (not your own, not an unclaimed listing; the database refuses those anyway);
 *   * a trainer: request a session or message (the trainers list's own actions);
 *   * a team: parents message the team's staff (only in parent mode, only staff who accept it).
 * Every action goes through the same code and rules as on the page itself.
 */
export function DiscoverCardActions({ org }: { org: Org }) {
  // Ownership comes from the local org store, known only after mount (as on the pages).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const mine = mounted && isMyOrg(org.id);
  const unclaimed = mounted && isOrgUnclaimed(org.id);
  const canFollow = mounted && !mine && !unclaimed;

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2 px-1"
      data-testid="discover-card-actions"
    >
      {canFollow && <FollowEntityButton kind="team" id={org.id} name={org.name} size="sm" />}
      {org.kind === "coach" ? (
        !mine && <TrainerActions org={org} />
      ) : (
        <GuardianTeamContactAction teamId={org.id} />
      )}
    </div>
  );
}
