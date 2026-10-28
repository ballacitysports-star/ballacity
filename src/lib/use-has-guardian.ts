import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/** Whether the signed-in member has an active guardian (a minor whose parent is linked). */
export function useHasActiveGuardian(): boolean {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["has-active-guardian", user?.id ?? null],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: links } = await supabase
        .from("guardian_links")
        .select("id")
        .eq("child_user_id", user!.id)
        .eq("status", "active")
        .limit(1);
      return (links ?? []).length > 0;
    },
  });
  return !!data;
}
