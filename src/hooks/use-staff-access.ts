import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { getMyStaffAccess } from "@/lib/staff.functions";
import { NO_STAFF_ACCESS, type StaffAccess } from "@/lib/staff";

/** Staff tiers for the signed-in user. Non-staff and signed-out users get no access. */
export function useStaffAccess(): { access: StaffAccess; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const fetchAccess = useServerFn(getMyStaffAccess);
  const query = useQuery({
    queryKey: ["staff-access", user?.id ?? null],
    queryFn: () => fetchAccess(),
    enabled: !!user,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return {
    access: query.data ?? NO_STAFF_ACCESS,
    loading: authLoading || (!!user && query.isLoading),
  };
}
