// The replay order of the two migration folders, shared by scripts/db-test.mjs (the replay tests) and
// scripts/release-preflight.mjs (the release manifest and its checks), so the two can never order them differently.
//
// supabase/migrations holds ours, sorted by the 14-digit version in the file name; drizzle/migrations holds the ones
// Lovable's tool writes and applies, sorted by `when` in its journal. They are replayed together in timestamp order;
// at the same instant ours goes first.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Hotfixes dated before the privacy release range that ship to production ahead of it. Their exact text is pinned
// (release-preflight.mjs, `pinned_history` in the manifest): offline the file must still match; online the target must
// record that text, either as its ledger row's statements[1] (the release template) or as a drizzle ledger hash
// (Lovable's migration tool). Every migration dated after the newest known-unledgered historical file and before the
// range must be listed here (release-preflight.mjs, checkManifest).
export const PINNED_HISTORY = [
  {
    version: "20261031120000",
    basis:
      "PR #287: live write-path hotfix (audit F02, F11-F13). Applied to production ahead of the privacy release with its exact text: through Lovable's migration tool (drizzle ledger hash) or with the release ledger template (statements = the file text).",
  },
  {
    version: "20261102100000",
    basis:
      "PR #295: only a game's host may write its payment settings (the write half of #250, closing a live join-approval bypass). Applied to production on 2026-11-05 through Lovable's migration tool with its exact text (drizzle ledger hash; Lovable's copy is drizzle/migrations/0033_hotfix_payment_settings_host_guard.sql).",
  },
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The sha256 of a text and of the same text with its one trailing newline removed, or added. */
function textHashes(bytes) {
  const out = new Set([sha256(bytes)]);
  if (bytes.length && bytes[bytes.length - 1] === 0x0a) out.add(sha256(bytes.subarray(0, -1)));
  else out.add(sha256(Buffer.concat([bytes, Buffer.from("\n")])));
  return out;
}

/**
 * The drizzle journal tags whose SQL is a copy of a pinned hotfix: byte for byte, or one trailing newline apart.
 *
 * Lovable's migration tool may write such a copy into drizzle/migrations, dated when it applied the hotfix (PR #287:
 * 0032_hotfix_close_write_paths, 2026-11-05 17:14 UTC). That date falls among the release migrations' versions, yet
 * production applies every release migration after the hotfix. Production ran the hotfix once, ahead of the release,
 * which is exactly where its own version places it, so the copy is not replayed a second time: replaying it again at
 * its drizzle date would reset what release migrations dated before that redefine (20261103120000 redefines
 * "Reviewees view their private reviews"). Copies of other migrations are kept: they were applied at their drizzle
 * date, before the release range, so replaying them there matches production.
 */
export function pinnedDrizzleCopies(root, journalEntries) {
  const pinned = new Set();
  const files = readdirSync(join(root, "supabase/migrations"));
  for (const p of PINNED_HISTORY) {
    const file = files.find((n) => n.startsWith(`${p.version}_`) && n.endsWith(".sql"));
    if (file)
      for (const h of textHashes(readFileSync(join(root, "supabase/migrations", file))))
        pinned.add(h);
  }
  const copies = new Set();
  for (const entry of journalEntries) {
    const path = join(root, "drizzle/migrations", `${entry.tag}.sql`);
    if (existsSync(path) && pinned.has(sha256(readFileSync(path)))) copies.add(entry.tag);
  }
  return copies;
}

/** All migrations in replay order, without drizzle copies of pinned hotfixes (pinnedDrizzleCopies). */
export function migrationOrder(root) {
  const rows = [];
  for (const file of readdirSync(join(root, "supabase/migrations"))) {
    if (!file.endsWith(".sql")) continue;
    const version = file.slice(0, 14);
    rows.push({
      key: `${version}a${file}`,
      version,
      source: "supabase",
      path: `supabase/migrations/${file}`,
      name: file.replace(/\.sql$/, ""),
    });
  }
  const journalPath = join(root, "drizzle/migrations/meta/_journal.json");
  if (existsSync(journalPath)) {
    const entries = JSON.parse(readFileSync(journalPath, "utf8")).entries;
    const copies = pinnedDrizzleCopies(root, entries);
    for (const entry of entries) {
      if (copies.has(entry.tag)) continue;
      const version = new Date(entry.when).toISOString().replace(/\D/g, "").slice(0, 14);
      rows.push({
        key: `${version}b${entry.tag}`,
        version,
        source: "drizzle",
        path: `drizzle/migrations/${entry.tag}.sql`,
        name: entry.tag,
        when: entry.when,
      });
    }
  }
  return rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
