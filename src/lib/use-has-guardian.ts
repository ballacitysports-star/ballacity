import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { fetchHasGuardianLinkInForce } from "@/lib/guardian-link-in-force";

/**
 * Whether the signed-in member has a guardian link in force (a minor whose parent is linked, or a managed account).
 * A link ends when the child turns 18 (20261125200000), so an adult is never asked for a guardian's approval.
 */
export function useHasActiveGuardian(): boolean {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["has-active-guardian", user?.id ?? null],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: () => fetchHasGuardianLinkInForce(user!.id),
  });
  return !!data;
}
