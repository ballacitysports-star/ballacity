// Every file in supabase/migrations is recorded in supabase_migrations.schema_migrations by its 14-digit version, and
// `version` is that table's primary key: two files with one version can never both have a ledger row, and the Supabase
// CLI cannot apply both. Four such pairs already exist and are applied in production by catalog evidence (2026-11-05,
// docs/migration-history-reconciliation.md section 9). They are reviewed and must not be renamed. Any other shared
// version fails here, so a new collision is caught in review instead of at release time.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Reviewed historical collisions: version -> the exact files that share it. */
const KNOWN_SHARED_VERSIONS = {
  20261008140000: ["20261008140000_refund_policies.sql", "20261008140000_teen_reel_sharing.sql"],
  20261008160000: [
    "20261008160000_family_post_links.sql",
    "20261008160000_guardian_cancel_child_game.sql",
  ],
  20261008170000: [
    "20261008170000_family_post_team_tier.sql",
    "20261008170000_guardian_refund_notices.sql",
  ],
  20261020120000: [
    "20261020120000_accept_message_request.sql",
    "20261020120000_hide_posts_and_comments.sql",
  ],
};

function migrationFiles() {
  return readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
}

describe("migration versions", () => {
  it("every file name starts with a 14-digit version and an underscore", () => {
    for (const f of migrationFiles()) expect(f, f).toMatch(/^\d{14}_[^\s]+\.sql$/);
  });

  it("no version is shared except the four reviewed historical pairs", () => {
    const byVersion = new Map();
    for (const f of migrationFiles()) {
      const v = f.slice(0, 14);
      byVersion.set(v, [...(byVersion.get(v) ?? []), f]);
    }
    const shared = Object.fromEntries(
      [...byVersion].filter(([, files]) => files.length > 1).map(([v, files]) => [v, files.sort()]),
    );
    expect(shared).toEqual(KNOWN_SHARED_VERSIONS);
  });
});
