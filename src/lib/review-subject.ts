import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { RevieweeKind } from "@/lib/reviews";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reviews about these kinds are about a person; the rest are about teams, trainers or places. */
export function isPersonKind(kind: RevieweeKind | string): boolean {
  return kind === "player" || kind === "host";
}

/**
 * Whether the reviews and reputation of this subject may be shown: only a confirmed adult's.
 *
 *  - `true`   a person who is a confirmed adult, or a subject that is not a person
 *  - `false`  a person under 18, of unknown age, an id that is not an account, or a failed lookup
 *  - `undefined`  still loading (render nothing yet, so a minor's section never flashes)
 *
 * This only decides what to render. The database enforces the rule: reviews, AI summaries and
 * review statistics about a person under 18 are not readable by others whatever the page does.
 */
export function useReviewSubjectIsAdult(
  revieweeId: string,
  kind: RevieweeKind | string = "player",
): boolean | undefined {
  const { user, loading: authLoading } = useAuth();
  const person = isPersonKind(kind);
  const id = revieweeId === "me" ? user?.id : revieweeId;
  const valid = !!id && UUID.test(id);
  const q = useQuery({
    queryKey: ["review-subject-cohort", id ?? null],
    enabled: person && valid,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("age_cohort")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return (data?.age_cohort as string | null | undefined) ?? null;
    },
  });
  if (!person) return true;
  if (revieweeId === "me" && authLoading) return undefined;
  if (!valid) return false;
  if (q.isLoading) return undefined;
  if (q.isError) return false;
  return q.data === "adult";
}
