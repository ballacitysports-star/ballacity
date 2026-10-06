import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listFacilitiesForTrainers } from "@/lib/trainer-orgs.functions";
import { summarizeRatings } from "@/lib/featured-trainer";

const CHUNK = 80;

/**
 * Real review stats and facility affiliations for the trainers on screen, each
 * fetched in one batch rather than per card. Both are best-effort: a failure
 * just means the cards show what they already have.
 */
export function useTrainerDirectoryData(trainerIds: readonly string[]) {
  const ids = useMemo(() => [...new Set(trainerIds)].sort(), [trainerIds]);
  const key = ids.join(",");

  const ratings = useQuery({
    queryKey: ["trainer-directory-ratings", key],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows: { reviewee_id: string; rating: number }[] = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        // Public, unflagged reviews only (row-level security applies).
        const { data, error } = await supabase
          .from("reviews")
          .select("reviewee_id, rating")
          .eq("reviewee_kind", "trainer")
          .in("reviewee_id", ids.slice(i, i + CHUNK));
        if (error) throw new Error(error.message);
        rows.push(...(data ?? []));
      }
      return summarizeRatings(rows);
    },
  });

  const facilities = useQuery({
    queryKey: ["trainer-directory-facilities", key],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => listFacilitiesForTrainers({ data: { trainerIds: ids.slice(0, 300) } }),
  });

  return {
    ratings: ratings.data ?? new Map<string, { avg: number; count: number }>(),
    facilities: facilities.data ?? ({} as Record<string, { id: string; name: string }>),
  };
}
