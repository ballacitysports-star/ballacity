import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSuperadmin, getAdmin, countRows } from "@/lib/superadmin.server";

export type SuperadminAttention = {
  birthdayCorrections: number;
  guardianRequests: number;
  ageReviews: number;
  pendingClaims: number;
  legalDrafts: number;
  stuckReels: number;
};

/** One count per unified queue, using the same filters as the queue itself. */
export const superadminAttention = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SuperadminAttention> => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { MAX_ATTEMPTS, STUCK_AFTER_MS } = await import("@/lib/reels-pipeline.server");
    const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS).toISOString();

    const [
      birthdayCorrections,
      guardianRequests,
      ageReviews,
      pendingClaims,
      legalDrafts,
      failed,
      stuck,
    ] = await Promise.all([
      countRows(admin, "birthday_correction_requests", (q: any) => q.eq("status", "pending")),
      countRows(admin, "parent_requests", (q: any) => q.in("status", ["open", "in_progress"])),
      countRows(admin, "profiles", (q: any) => q.eq("age_review_required", true)),
      countRows(admin, "listing_claims", (q: any) => q.eq("status", "pending")),
      countRows(admin, "legal_documents", (q: any) =>
        q.eq("published", false).is("published_at", null).is("archived_at", null),
      ),
      countRows(admin, "highlight_reels", (q: any) => q.eq("status", "failed")),
      countRows(admin, "highlight_reels", (q: any) =>
        q
          .eq("status", "processing")
          .or(`processing_started_at.lt.${stuckBefore},attempts.gte.${MAX_ATTEMPTS}`),
      ),
    ]);

    return {
      birthdayCorrections,
      guardianRequests,
      ageReviews,
      pendingClaims,
      legalDrafts,
      stuckReels: failed + stuck,
    };
  });
