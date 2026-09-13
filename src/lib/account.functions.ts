import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Every bucket that stores user-uploaded media under a `<user id>/` prefix.
const MEDIA_BUCKETS = [
  "avatars",
  "covers",
  "game-covers",
  "highlight-videos",
  "message-attachments",
  "payment-proofs",
  "team-covers",
  "team-avatars",
  "org-covers",
  "org-avatars",
  "trainer-avatars",
];

/**
 * Permanently delete the currently authenticated user's account.
 *
 * Order matters:
 *  1. Scrub personal information from rows other people may still reference
 *     (so anything not cascaded is anonymized rather than left identifiable).
 *  2. Remove uploaded media from storage — files are not covered by cascades.
 *  3. Delete the auth user, which cascades the user's own rows.
 *
 * Safety records (reports/blocks filed about the account) intentionally survive;
 * they no longer carry any profile details. Retention periods require legal review.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Anonymize profile PII before removal.
    await supabaseAdmin
      .from("profiles")
      .update({
        display_name: "Deleted user",
        username: null,
        avatar_initials: "??",
        bio: null,
        city: null,

        avatar_url: null,
        avatar_url_private: null,
        cover_url: null,
        links: [],
        graduating_class: null,
      } as never)
      .eq("id", userId);

    // Birthdays live in a private table; scrub it too.
    await supabaseAdmin.from("profile_birthdays").delete().eq("user_id", userId);

    // Message bodies and attachments are stripped even though rows cascade,
    // so no personal content survives in another participant's cached thread.
    await supabaseAdmin
      .from("messages")
      .update({
        body: null,
        attachment_path: null,
        attachment_name: null,
        attachment_type: null,
        attachment_size: null,
        deleted_at: new Date().toISOString(),
      } as never)
      .eq("sender_id", userId);

    await supabaseAdmin
      .from("post_comments")
      .update({ body: "[removed]", deleted_at: new Date().toISOString() } as never)
      .eq("author_id", userId);

    // Explicit removal of location-bearing and media rows.
    await supabaseAdmin.from("player_availabilities").delete().eq("user_id", userId);
    await supabaseAdmin.from("highlight_reels").delete().eq("user_id", userId);
    await supabaseAdmin.from("privacy_preferences").delete().eq("user_id", userId);
    await supabaseAdmin.from("host_payment_methods").delete().eq("host_id", userId);

    // 2. Delete uploaded media owned by this user.
    for (const bucket of MEDIA_BUCKETS) {
      try {
        const { data: files } = await supabaseAdmin.storage.from(bucket).list(userId, {
          limit: 1000,
        });
        const paths = (files ?? []).filter((f) => !!f.name).map((f) => `${userId}/${f.name}`);
        if (paths.length > 0) await supabaseAdmin.storage.from(bucket).remove(paths);
      } catch {
        // Bucket may not exist in every environment — deletion must still proceed.
      }
    }

    // 3. Delete the auth user (cascades the user's remaining rows).
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
