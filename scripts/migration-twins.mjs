/**
 * P0-4: the replay applies every migration exactly once.
 *
 * Nine migrations were committed to both folders with identical content: once in
 * supabase/migrations and once in drizzle/migrations (which Lovable writes and applies).
 * Production applied each of them once, so the replay applies only the copy that comes first in
 * replay order and skips its twin. Those nine pairs are listed here by name. Any other file whose
 * content matches one already replayed is an error: commit a migration to one folder only.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** The supabase/migrations copy of each known twin, with the drizzle copy it duplicates. */
export const KNOWN_TWINS = {
  "20260915214000_freeze_payment_claim_metadata_on_dispute.sql":
    "0021_freeze_payment_claim_metadata_on_dispute.sql",
  "20261021140000_listing_discovery.sql": "0022_listing_discovery.sql",
  "20261022130000_listing_claim_review.sql": "0030_listing_claim_review.sql",
  "20261023120000_payment_health_metrics.sql": "0029_payment_health_metrics.sql",
  "20261027120000_join_gate_hardening.sql": "0024_join_gate_hardening.sql",
  "20261027130000_guardian_join_request_either_order.sql":
    "0025_guardian_join_request_either_order.sql",
  "20261027140000_team_members_no_direct_minor_add.sql":
    "0026_team_members_no_direct_minor_add.sql",
  "20261027150000_waitlist_notified_on_leave.sql": "0027_waitlist_notified_on_leave.sql",
  "20261027160000_trainer_org_no_forged_affiliation.sql":
    "0028_trainer_org_no_forged_affiliation.sql",
};

const isKnownPair = (a, b) => KNOWN_TWINS[a] === b || KNOWN_TWINS[b] === a;

export const fileDigest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * Takes migrations in replay order ({ name, path }) and returns the ones to replay and the known
 * twins skipped. Throws on any other duplicate content, naming both files.
 */
export function dedupeMigrations(migrations, digestOf = (m) => fileDigest(m.path)) {
  const seen = new Map();
  const replay = [];
  const skipped = [];
  for (const m of migrations) {
    const d = digestOf(m);
    const first = seen.get(d);
    if (!first) {
      seen.set(d, m);
      replay.push(m);
      continue;
    }
    if (isKnownPair(first.name, m.name)) {
      skipped.push({ name: m.name, twinOf: first.name });
      continue;
    }
    throw new Error(
      `Duplicate migration: ${m.name} is identical to ${first.name}, and both would be replayed. ` +
        "Commit a migration to one folder only (keep the drizzle copy if Lovable already applied it).",
    );
  }
  return { replay, skipped };
}
