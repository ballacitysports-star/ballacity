import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LISTING_KINDS, hideErrorMessage } from "./listing-visibility";

/**
 * Hide a listing from the public, or show it again. The database function
 * re-checks that the caller owns or manages it; nothing here decides that.
 *
 * Returns whether the listing is still hidden afterwards: after a "show" it can
 * still be hidden by BallaCity moderators, whose Hide an owner cannot lift.
 */
export const setListingHidden = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { kind: string; id: string; hidden: boolean }) =>
    z
      .object({
        kind: z.enum(LISTING_KINDS),
        id: z.string().min(1).max(64),
        hidden: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ stillHidden: boolean }> => {
    const { data: effective, error } = await context.supabase.rpc(
      "set_listing_hidden" as never,
      { _kind: data.kind, _id: data.id, _hidden: data.hidden } as never,
    );
    if (error) throw new Error(hideErrorMessage(error.message));
    return { stillHidden: effective !== null && effective !== undefined };
  });
