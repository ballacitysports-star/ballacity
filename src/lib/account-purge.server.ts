import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isMissingRelationError, managedChildErrorMessage } from "@/lib/managed-children";
import { IMAGE_STAGING_BUCKET } from "@/lib/image-staging";

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

/** image_moderation statuses that put a staged file under a hold: kept as evidence (possible child-safety content), never purged. */
const STAGING_HOLD_STATUSES = new Set(["quarantined"]);

/**
 * Remove the account's staged image uploads (`image-staging/{userId}/...`, SEC-7), except any file the scan or a reviewer put on hold:
 * a quarantined original is evidence and stays (its image_moderation row keeps it findable; owner_id becomes NULL with the account).
 * Fails closed: if the hold lookup fails, nothing in staging is removed. Moderation rows of removed files are removed with them.
 */
export async function purgeImageStaging(
  admin: any,
  userId: string,
): Promise<{ removed: number; held: number }> {
  const bucket = admin.storage.from(IMAGE_STAGING_BUCKET);
  const page = 1000;
  const paths: string[] = [];
  for (let offset = 0; ; offset += page) {
    const { data, error } = await bucket.list(userId, { limit: page, offset });
    if (error) return { removed: 0, held: 0 }; // no bucket in this environment, or nothing readable: nothing to remove
    const rows = (data ?? []) as { name?: string; id?: string | null }[];
    // files only: Storage lists a sub-folder with no id, and the staging policy allows no sub-folders anyway
    for (const f of rows) if (f.name && f.id) paths.push(`${userId}/${f.name}`);
    if (rows.length < page) break;
  }
  if (paths.length === 0) return { removed: 0, held: 0 };

  const { data: flagged, error: flagErr } = await admin
    .from("image_moderation")
    .select("path, status")
    .eq("bucket", IMAGE_STAGING_BUCKET)
    .in("path", paths);
  if (flagErr) throw new Error("Could not check held images before deleting staged uploads.");
  const held = new Set(
    ((flagged ?? []) as { path: string; status: string }[])
      .filter((r) => STAGING_HOLD_STATUSES.has(r.status))
      .map((r) => r.path),
  );
  const removable = paths.filter((p) => !held.has(p));
  if (removable.length > 0) {
    const { error } = await bucket.remove(removable);
    if (error) throw new Error(error.message);
    await admin
      .from("image_moderation")
      .delete()
      .eq("bucket", IMAGE_STAGING_BUCKET)
      .in("path", removable);
  }
  return { removed: removable.length, held: held.size };
}

/**
 * Refuse, before anything is erased, when the database will refuse the final delete.
 *
 * managed_accounts.managed_by and managed_device_pairings.created_by are ON DELETE RESTRICT, so an
 * account that still manages a child profile cannot be deleted. Steps 1 and 2 below are
 * irreversible, so finding that out only at step 3 would leave the account anonymised ("Deleted
 * user"), stripped of its media and still there. Every caller gets this check, so a superadmin
 * deleting a guardian is refused the same way a guardian deleting their own account is.
 */
async function assertNoManagedChildren(userId: string): Promise<void> {
  const [accounts, pairings] = await Promise.all([
    supabaseAdmin
      .from("managed_accounts")
      .select("child_user_id", { count: "exact", head: true })
      .eq("managed_by", userId),
    supabaseAdmin
      .from("managed_device_pairings")
      .select("child_user_id", { count: "exact", head: true })
      .eq("created_by", userId),
  ]);
  // Before the managed-children migration is applied there is no such table and nobody manages a
  // child. Any other failure is not "no children": this function erases before it deletes.
  for (const r of [accounts, pairings]) {
    if (r.error && !isMissingRelationError(r.error)) {
      throw new Error(managedChildErrorMessage("MANAGES_CHECK_FAILED"));
    }
  }
  const children = accounts.count ?? 0;
  if (children > 0 || (pairings.count ?? 0) > 0) {
    throw new Error(
      `${managedChildErrorMessage("MANAGES_CHILDREN")} This account manages ${children} child ${
        children === 1 ? "profile" : "profiles"
      }: delete ${children === 1 ? "it" : "them"} first (Parent Center, or from the child's own entry), then delete this account.`,
    );
  }
}

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
  // 0. Nothing below can be undone, so rule out a refused delete first.
  await assertNoManagedChildren(userId);

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

  // Staged originals in the private image-staging bucket, except files held as evidence (quarantined). If the hold check fails nothing
  // there is removed and the deletion still proceeds, like the buckets above; leftovers are not held, so the staging sweep removes them.
  try {
    await purgeImageStaging(supabaseAdmin, userId);
  } catch {
    // see above
  }

  // 3. Delete the auth user (cascades the user's remaining rows).
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
}
