import { useIsGuardianAccount } from "@/components/child/GuardianProfileCard";
import { useAuth } from "@/hooks/use-auth";
import { useMyProfiles } from "@/lib/account-profiles";
import { isManagedUser } from "@/lib/managed-children";

/**
 * Parent Mode is the guardian's base identity, not every session owned by a
 * guardian. Switching into a child or an organization profile deliberately
 * restores that profile's normal athlete/manager experience.
 */
export function useParentMode() {
  const { user } = useAuth();
  const guardian = useIsGuardianAccount();
  const profiles = useMyProfiles();
  const isParentMode =
    guardian.isGuardian && profiles.active?.kind === "player" && !isManagedUser(user);

  return {
    isParentMode,
    loading: guardian.loading || profiles.loading,
  };
}