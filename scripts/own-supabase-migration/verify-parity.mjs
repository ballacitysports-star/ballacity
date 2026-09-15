#!/usr/bin/env node
/**
 * Prints a row-count diff (every public.* table plus auth.users and
 * auth.identities) and a Storage object-count/byte diff (every bucket)
 * between the source and destination projects. This is the gate before
 * anyone edits .env.production — see README.md's "The cutover itself".
 *
 * Exits non-zero if anything doesn't match, so it can also be used as a
 * scripted check rather than eyeballing the table.
 *
 *   SOURCE_DATABASE_URL=postgresql://...  DEST_DATABASE_URL=postgresql://... \
 *   SOURCE_SUPABASE_URL=... SOURCE_SERVICE_ROLE_KEY=... \
 *   DEST_SUPABASE_URL=...   DEST_SERVICE_ROLE_KEY=... \
 *     node verify-parity.mjs
 *
 * Row counts alone don't prove content is byte-identical, only that nothing
 * was dropped or duplicated — good enough to catch a failed/partial copy,
 * which is what this is for.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Generated from src/integrations/supabase/types.ts's Tables block — keep in
// step with it if the schema changes after this script is written.
const PUBLIC_TABLES = [
  "account_profiles", "admin_audit_log", "age_change_events", "ai_generation_jobs",
  "ai_text_moderation", "ai_usage_events", "app_settings", "auth_signin_events",
  "availability_contact_requests", "birthday_change_audit", "birthday_correction_requests",
  "child_controls", "conversation_participants", "conversations", "data_export_requests",
  "family_audit_log", "feed_preferences", "follows", "game_participants",
  "game_payment_settings", "game_position_waitlist", "game_reminders",
  "game_safety_acknowledgments", "guardian_links", "highlight_reels", "host_payment_methods",
  "hosted_games", "image_moderation", "join_requests", "legal_consents", "legal_documents",
  "listing_claims", "location_denial_events", "message_reactions", "messages",
  "minor_invites", "notification_delivery_log", "notification_preferences", "notifications",
  "org_member_requests", "org_members", "parent_requests", "parental_consent_events",
  "parental_consents", "payment_submissions", "payment_verification_events",
  "player_availabilities", "player_profiles", "post_comments", "post_reactions",
  "privacy_preferences", "profile_birthdays", "profiles", "purchases", "review_helpfuls",
  "reviews", "scheduled_notifications", "session_activity", "subscriptions", "team_invites",
  "team_members", "team_posts", "teams", "trainer_org_invites", "trainer_org_join_requests",
  "trainer_org_members", "trainer_orgs", "trainer_session_requests", "user_blocks",
  "user_reports", "user_roles",
];

// Keep in sync with copy-storage.mjs.
const BUCKETS = [
  "avatars", "covers", "org-avatars", "org-covers", "team-avatars", "team-covers",
  "trainer-avatars", "game-covers", "payment-proofs", "message-attachments",
  "data-exports", "highlight-videos", "app-assets",
];

function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    console.error(`Missing ${key}. See README.md for where to find it.`);
    process.exit(1);
  }
  return value;
}

async function rowCount(databaseUrl, qualifiedTable) {
  const { stdout } = await execFileAsync("psql", [
    databaseUrl,
    "-X", "-A", "-t",
    "-c", `select count(*) from ${qualifiedTable}`,
  ]);
  return Number.parseInt(stdout.trim(), 10);
}

async function listAllObjects(baseUrl, serviceKey, bucket) {
  let count = 0;
  let bytes = 0;

  async function walk(prefix) {
    let offset = 0;
    const limit = 1000;
    for (;;) {
      const res = await fetch(`${baseUrl}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: { authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
        body: JSON.stringify({ prefix, limit, offset, sortBy: { column: "name", order: "asc" } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
      const entries = await res.json();
      for (const entry of entries) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id === null || entry.metadata == null) {
          await walk(path);
        } else {
          count++;
          bytes += entry.metadata.size ?? 0;
        }
      }
      if (entries.length < limit) break;
      offset += limit;
    }
  }

  await walk("");
  return { count, bytes };
}

function pad(s, n) {
  s = String(s);
  return s + " ".repeat(Math.max(0, n - s.length));
}

async function main() {
  const sourceDb = requireEnv("SOURCE_DATABASE_URL");
  const destDb = requireEnv("DEST_DATABASE_URL");
  const sourceUrl = requireEnv("SOURCE_SUPABASE_URL").replace(/\/+$/, "");
  const sourceKey = requireEnv("SOURCE_SERVICE_ROLE_KEY");
  const destUrl = requireEnv("DEST_SUPABASE_URL").replace(/\/+$/, "");
  const destKey = requireEnv("DEST_SERVICE_ROLE_KEY");

  let anyMismatch = false;

  console.log("## Database rows\n");
  console.log(pad("table", 34), pad("source", 10), pad("dest", 10), "status");
  for (const table of [...PUBLIC_TABLES.map((t) => `public.${t}`), "auth.users", "auth.identities"]) {
    const [src, dst] = await Promise.all([rowCount(sourceDb, table), rowCount(destDb, table)]);
    const ok = src === dst;
    if (!ok) anyMismatch = true;
    console.log(pad(table, 34), pad(src, 10), pad(dst, 10), ok ? "match" : "MISMATCH");
  }

  console.log("\n## Storage buckets\n");
  console.log(pad("bucket", 20), pad("src objects", 12), pad("dst objects", 12), pad("src bytes", 14), pad("dst bytes", 14), "status");
  for (const bucket of BUCKETS) {
    const [src, dst] = await Promise.all([
      listAllObjects(sourceUrl, sourceKey, bucket),
      listAllObjects(destUrl, destKey, bucket),
    ]);
    const ok = src.count === dst.count && src.bytes === dst.bytes;
    if (!ok) anyMismatch = true;
    console.log(
      pad(bucket, 20), pad(src.count, 12), pad(dst.count, 12),
      pad(src.bytes, 14), pad(dst.bytes, 14), ok ? "match" : "MISMATCH",
    );
  }

  console.log(anyMismatch ? "\nMISMATCHES FOUND — do not cut over until these are understood or resolved." : "\nAll counts match.");
  process.exit(anyMismatch ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
