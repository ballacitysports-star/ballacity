import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useMyProfiles } from "@/lib/account-profiles";
import { useMyProfile } from "@/lib/user-prefs-store";
import { listMyAvailabilities } from "@/lib/availability";
import { parseTimeSlots } from "@/lib/availability-timeslots";

export type AvailabilityGateReason = null | "signed_out" | "wrong_profile" | "incomplete_profile";

export type AvailabilityGate = {
  /** True when the viewer may post/edit their player availability. */
  canPost: boolean;
  reason: AvailabilityGateReason;
  /** The viewer already has at least one usable open availability post. */
  hasOpenAvailability: boolean;
  loading: boolean;
};

/**
 * Availability belongs to the personal player profile, so posting requires a
 * usable player (or trainer) profile — a gym/team context has to switch first.
 * Also reports whether the viewer already has an open post, which the game
 * flows use to prompt for completion.
 */
export function useAvailabilityGate(): AvailabilityGate {
  const { user, loading: authLoading } = useAuth();
  const { active, loading: profilesLoading } = useMyProfiles();
  const profile = useMyProfile();

  const availQuery = useQuery({
    queryKey: ["my-availabilities", user?.id],
    queryFn: () => listMyAvailabilities(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const hasOpenAvailability = useMemo(() => {
    const rows = availQuery.data ?? [];
    return rows.some(
      (r) =>
        r.status === "open" &&
        (r.sports?.length ?? 0) > 0 &&
        parseTimeSlots(r.time_slots ?? []).length > 0,
    );
  }, [availQuery.data]);

  const loading = authLoading || profilesLoading;

  let reason: AvailabilityGateReason = null;
  if (!user) reason = "signed_out";
  else if (active && active.kind !== "player" && active.kind !== "trainer")
    reason = "wrong_profile";
  else if (
    profile &&
    (!profile.name?.trim() || !(profile.sports ?? []).some((s) => !!s.level?.tier))
  )
    reason = "incomplete_profile";

  return {
    canPost: !loading && reason === null,
    reason,
    hasOpenAvailability,
    loading: loading || availQuery.isLoading,
  };
}

export function availabilityGateMessage(reason: AvailabilityGateReason): string {
  switch (reason) {
    case "signed_out":
      return "Sign in to post your availability.";
    case "wrong_profile":
      return "Availability is posted from your player profile.";
    case "incomplete_profile":
      return "Add your sports and level to post availability.";
    default:
      return "";
  }
}
