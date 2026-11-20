/**
 * The guardian links in force for some children, from the database rule (20261125200000, owner decision 2026-11-20:
 * a guardian link ends when the child turns 18): a link counts while its status is 'active' AND the child is not a
 * known adult (a managed account is the exception: its guardian is the only way in, so its link stays). The rule lives
 * in SQL (public.guardian_links_in_force, service role only) so server code never keeps its own copy of it.
 *
 * If that function is missing (the app deployed before the migration, or the migration rolled back) this falls back to
 * what every reader did before: the rows whose status is 'active'. That keeps a minor's guardian protections on and
 * only means an adult's old link is not yet treated as ended; it never fails open for a minor.
 *
 * Returns the PostgREST shape ({ data, error }) so a caller that already checks `.error` keeps its handling.
 */
// Any Supabase client (typed or a test stub); rpc is optional so a stub without it reads the table, as before.
type Admin = { from: (...args: any[]) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type GuardianLinkInForce = {
  parent_user_id: string;
  child_user_id: string;
  verified_at: string | null;
};

export type GuardianLinksResult = {
  data: GuardianLinkInForce[] | null;
  error: { message: string } | null;
};

export async function guardianLinksInForce(
  admin: Admin,
  childIds: readonly string[],
): Promise<GuardianLinksResult> {
  const ids = [...new Set(childIds)];
  if (ids.length === 0) return { data: [], error: null };
  const rpc = (
    admin as {
      rpc?: (
        fn: string,
        args: Record<string, unknown>,
      ) => PromiseLike<{ data: unknown; error: unknown }>;
    }
  ).rpc;
  if (typeof rpc === "function") {
    const viaRule = await rpc.call(admin, "guardian_links_in_force", { _children: ids });
    if (!viaRule?.error && Array.isArray(viaRule?.data)) {
      return { data: viaRule.data as GuardianLinkInForce[], error: null };
    }
  }
  const { data, error } = await admin
    .from("guardian_links")
    .select("parent_user_id, child_user_id, verified_at")
    .in("child_user_id", ids)
    .eq("status", "active");
  return {
    data: (data as GuardianLinkInForce[] | null) ?? null,
    error: error ? { message: String(error.message ?? error) } : null,
  };
}
