import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * The signed-in member's age group as the database sees it: "child_under_13",
 * "teen_13_15", "teen_16_17", "adult" or "unknown". Finer than the app's
 * adult/teen/child category, which cannot tell 15 from 16, and that line decides
 * who can approve followers and which reel audiences are offered.
 */
export function useMyAgeCohort() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["my-age-cohort", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.rpc("my_age_cohort" as never);
      return typeof data === "string" ? data : "unknown";
    },
  });
  return { cohort: query.data ?? "unknown", loading: !!user && query.isLoading };
}
