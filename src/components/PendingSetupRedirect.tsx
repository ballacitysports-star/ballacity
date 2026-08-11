import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { addProfileRoute, useMyProfiles } from "@/lib/account-profiles";

/**
 * Registering as a team, trainer, or gym is only finished once that profile
 * exists. Until then the app has nothing to act as and would silently fall
 * back to the player profile, so the tabs bounce into the matching setup
 * screen (which offers "Continue as a player instead").
 */
export function PendingSetupRedirect() {
  const { pendingKind, loading } = useMyProfiles();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !pendingKind) return;
    navigate({
      to: addProfileRoute(pendingKind),
      search: { finish: 1 },
      replace: true,
    } as never);
  }, [pendingKind, loading, navigate]);

  return null;
}
