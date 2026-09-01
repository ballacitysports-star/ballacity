import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_YOUTH_FLAGS,
  parseYouthFlags,
  type AgeCategory,
  type YouthFlags,
} from "@/lib/age-policy";

/**
 * Youth feature flags live in `app_settings` under the `youth_features` key
 * and are readable by everyone (the values are policy switches, not data).
 * Only superadmins can change them.
 */
export async function fetchYouthFlags(): Promise<YouthFlags> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "youth_features")
    .maybeSingle();
  if (error || !data) return { ...DEFAULT_YOUTH_FLAGS };
  return parseYouthFlags((data as { value: unknown }).value);
}

export function useYouthFlags() {
  const q = useQuery({
    queryKey: ["youth-flags"],
    queryFn: fetchYouthFlags,
    staleTime: 5 * 60_000,
  });
  return { flags: q.data ?? { ...DEFAULT_YOUTH_FLAGS }, loading: q.isLoading, refetch: q.refetch };
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
