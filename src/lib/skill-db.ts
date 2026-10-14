import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { SkillReport } from "@/lib/skill-rating.server";

export type SkillRatingRow = {
  sport: string;
  mu: number;
  low: number;
  high: number;
  status: "provisional" | "developing" | "established";
  label: string;
  hidden: boolean;
  signals: {
    contributions?: { self: number; peer: number; video: number };
    counts?: { peer: number; video: number };
  };
  report: SkillReport | null;
  report_at: string | null;
};

export function useSkillRatings(userId: string | undefined) {
  return useQuery({
    queryKey: ["skill-ratings", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<SkillRatingRow[]> => {
      const { data, error } = await supabase
        .from("skill_ratings")
        .select("sport, mu, low, high, status, label, hidden, signals, report, report_at")
        .eq("user_id", userId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SkillRatingRow[];
    },
  });
}

/** The signed-in player's rating range for one sport, if they have one. */
export function useMySkillRange(sport: string) {
  const { user } = useAuth();
  const { data } = useSkillRatings(user?.id);
  return data?.find((r) => r.sport === sport) ?? null;
}
