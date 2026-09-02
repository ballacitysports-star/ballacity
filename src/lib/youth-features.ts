import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_AGE_POLICY,
  parseAgePolicy,
  parseCohort,
  type AgeCohort,
  type AgePolicyConfig,
} from "@/lib/child-policy";
import type { AgeCategory } from "@/lib/age-policy";

/**
 * The age-policy configuration lives in `app_settings` under the `age_policy`
 * key and is readable by everyone (the values are policy switches, not data).
 * Only superadmins can change it. The database reads the same row through
 * `age_policy_flag()` / `age_policy_number()`, so client and server agree.
 */
export async function fetchAgePolicy(): Promise<AgePolicyConfig> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "age_policy")
    .maybeSingle();
  if (error || !data) return { ...DEFAULT_AGE_POLICY };
  return parseAgePolicy((data as { value: unknown }).value);
}

export function useAgePolicy() {
  const q = useQuery({
    queryKey: ["age-policy"],
    queryFn: fetchAgePolicy,
    staleTime: 5 * 60_000,
  });
  return {
    policy: q.data ?? { ...DEFAULT_AGE_POLICY },
    loading: q.isLoading,
    refetch: q.refetch,
  };
}

/** The signed-in member's own age category (private: self-readable only). */
export async function fetchMyAgeCategory(): Promise<AgeCategory> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return "unknown";
  const { data } = await (supabase.rpc as any)("my_age_category");
  const cat = typeof data === "string" ? data : "unknown";
  return (["adult", "teen", "child", "unknown"] as const).includes(cat as AgeCategory)
    ? (cat as AgeCategory)
    : "unknown";
}

export function useMyAgeCategory() {
  const q = useQuery({
    queryKey: ["my-age-category"],
    queryFn: fetchMyAgeCategory,
    staleTime: 5 * 60_000,
  });
  return { category: (q.data ?? "unknown") as AgeCategory, loading: q.isLoading };
}

/** The signed-in member's fine-grained cohort (child / teen bands / adult). */
export async function fetchMyCohort(): Promise<AgeCohort> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return "unknown";
  const { data } = await (supabase.rpc as any)("my_age_cohort");
  return parseCohort(data);
}

export function useMyCohort() {
  const q = useQuery({
    queryKey: ["my-age-cohort"],
    queryFn: fetchMyCohort,
    staleTime: 5 * 60_000,
  });
  return { cohort: (q.data ?? "unknown") as AgeCohort, loading: q.isLoading };
}
