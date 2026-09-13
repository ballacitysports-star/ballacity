import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AccountTypeName = "player" | "team" | "trainer" | "gym";

/**
 * Confirms the caller has a profile before a privileged create/mutation runs.
 * Accounts can hold several profiles at once (player + any number of team,
 * trainer, and gym profiles), so the caller's currently active type no longer
 * restricts which kind of profile they may create.
 */
export async function requireAccountType(
  supabase: SupabaseClient<Database>,
  userId: string,
  _allowed: AccountTypeName | AccountTypeName[],
): Promise<AccountTypeName> {
  const { data, error } = await supabase
    .from("profiles")
    .select("account_type")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error("Your account has no profile yet. Please sign in again.");
  }
  const type = (data as { account_type?: string | null }).account_type as
    AccountTypeName | undefined;
  return type ?? "player";
}
