import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AccountTypeName = "player" | "team" | "trainer" | "gym";

/**
 * Server-side authorization guard. Confirms the signed-in user's
 * profiles.account_type matches one of the allowed values before a
 * privileged create/mutation runs. DB triggers also enforce this, but
 * checking here fails fast with a clear message and prevents mismatched
 * writes even if a client hits the endpoint directly.
 */
export async function requireAccountType(
  supabase: SupabaseClient<Database>,
  userId: string,
  allowed: AccountTypeName | AccountTypeName[],
): Promise<AccountTypeName> {
  const allowedList = Array.isArray(allowed) ? allowed : [allowed];
  const { data, error } = await supabase
    .from("profiles")
    .select("account_type")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const type = (data as { account_type?: string } | null)?.account_type as
    | AccountTypeName
    | undefined;
  if (!type) {
    throw new Error("Your account has no account type set. Please sign in again.");
  }
  if (!allowedList.includes(type)) {
    const need = allowedList.join(" or ");
    throw new Error(
      `This action requires a ${need} account. Your account is a ${type}. ` +
        `Each account can only be one type; sign up with a different email to create a ${need} profile.`,
    );
  }
  return type;
}
