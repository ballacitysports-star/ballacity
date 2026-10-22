import { useGuardianApprovals } from "@/lib/guardian-approvals";
import { useFamilyRoster } from "@/lib/family-roster";
import { familyPending, type FamilyPending } from "@/lib/family-pending";

/**
 * What is waiting on the signed-in parent. Only call it where the viewer is a
 * parent (it reads their children), so the bar and the Me page mount it
 * conditionally.
 */
export function useFamilyPending(): { pending: FamilyPending; isLoading: boolean } {
  const approvals = useGuardianApprovals();
  const roster = useFamilyRoster();
  return {
    pending: familyPending({
      invites: approvals.invites,
      requests: approvals.requests,
      waitingChildren: roster.needsAction.length,
    }),
    isLoading: approvals.isLoading || roster.isLoading,
  };
}
