import { supabase } from "@/integrations/supabase/client";

/**
 * Whether the signed-in member has a guardian link in force (20261125200000): a minor with a linked guardian, or a
 * managed account. A link to someone who has turned 18 is not in force, even before the daily job has ended it, so a
 * new adult is not shown "ask your guardian" prompts. The rule is the database's (public.my_guardian_link_in_force);
 * if that function is missing (app ahead of the migration, or the migration rolled back) this reads the member's own
 * active links as before, which keeps a minor's guardian prompts on.
 */
export async function fetchHasGuardianLinkInForce(userId: string): Promise<boolean> {
  const viaRule = (await supabase.rpc("my_guardian_link_in_force" as never)) as {
    data: unknown;
    error: unknown;
  };
  if (!viaRule.error && typeof viaRule.data === "boolean") return viaRule.data;
  const { data: links } = await supabase
    .from("guardian_links")
    .select("id")
    .eq("child_user_id", userId)
    .eq("status", "active")
    .limit(1);
  return (links ?? []).length > 0;
}
