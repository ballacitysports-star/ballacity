import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
 * Permanently delete one account and everything it owns.
 *
 * Shared by self-service deletion (`deleteMyAccount`) and by a guardian
 * deleting a managed child (`deleteManagedChild`). Callers do the
 * authorization; this only erases.
 *
 * Order matters:
 *  1. Scrub personal information from rows other people may still reference
 *     (so anything not cascaded is anonymized rather than left identifiable).
 *  2. Remove uploaded media from storage — files are not covered by cascades.
 *  3. Delete the auth user, which cascades the user's own rows.
 *
 * `profile_birthdays` is deliberately not deleted here: while the auth user
 * still exists `guard_birthday_immutability` refuses the delete with
 * BIRTHDAY_LOCKED, and the cascade from step 3 removes the row anyway.
 *
 * Safety records (reports/blocks filed about the account) intentionally survive;
 * they no longer carry any profile details. Retention periods require legal review.
 */
export async function purgeUserAccount(userId: string): Promise<void> {
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
  // account_profiles.user_id has no foreign key, so the cascade in step 3
  // never reaches the account's own player row.
  await supabaseAdmin.from("account_profiles").delete().eq("user_id", userId);
  // The same goes for these three: keyed by user_id with no foreign key, an inbox
  // entry, a queued push and a session-time row would outlive the account under
  // an id that no longer exists.
  await supabaseAdmin.from("notifications").delete().eq("user_id", userId);
  await supabaseAdmin.from("scheduled_notifications").delete().eq("user_id", userId);
  await supabaseAdmin.from("session_activity").delete().eq("user_id", userId);

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
}
