import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  isManagedUser,
  isMissingRelationError,
  managedChildErrorMessage,
} from "@/lib/managed-children";

/**
 * Permanently delete the currently authenticated user's account.
 *
 * The erase itself lives in `purgeUserAccount` so a guardian deleting a
 * managed child runs exactly the same steps.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;

    // A managed child's profile is deleted by their guardian from the Parent
    // Center; a guardian switched into it must not erase it from here.
    if (isManagedUser({ app_metadata: context.claims?.app_metadata ?? {} })) {
      throw new Error(managedChildErrorMessage("MANAGED_SESSION_NOT_ALLOWED"));
    }

    // Children this account manages have no login of their own. Refuse before
    // anything is scrubbed: managed_accounts.managed_by is ON DELETE RESTRICT,
    // so the final delete would fail anyway — but only after this account's
    // profile had already been anonymised.
    const { count, error: countError } = await context.supabase
      .from("managed_accounts")
      .select("child_user_id", { count: "exact", head: true })
      .eq("managed_by", userId);
    // Before the managed-children migration is applied there is no such table
    // and nobody can manage a child. Any other failure must not be read as "no
    // children": this function anonymises the account before it deletes it.
    if (countError && !isMissingRelationError(countError)) {
      throw new Error(managedChildErrorMessage("MANAGES_CHECK_FAILED"));
    }
    if ((count ?? 0) > 0) {
      throw new Error(
        `${managedChildErrorMessage("MANAGES_CHILDREN")} You manage ${count} child ${
          count === 1 ? "profile" : "profiles"
        } — delete ${count === 1 ? "it" : "them"} from the Parent Center first.`,
      );
    }

    const { purgeUserAccount } = await import("@/lib/account-purge.server");
    await purgeUserAccount(userId);
    return { ok: true };
  });
