// The order the migrations are replayed in, shared by scripts/db-test.mjs (the CI replay) and
// e2e/local-stack/stack.mjs (the local E2E backend), so both build the schema the same way.
//
// supabase/migrations holds ours, drizzle/migrations holds the ones Lovable writes and applies
// itself. The live schema is both together, so they are replayed together in timestamp order (a
// drizzle entry's time is `when` in its journal; at the same instant ours goes first). Pass the
// result through dedupeMigrations (scripts/migration-twins.mjs) before applying it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Every migration under `root`, in replay order, as { key, path, name }. */
export function migrationOrder(root) {
  const rows = [];
  for (const file of readdirSync(join(root, "supabase/migrations"))) {
    if (file.endsWith(".sql")) {
      rows.push({
        key: `${file.slice(0, 14)}a${file}`,
        path: join(root, "supabase/migrations", file),
        name: file,
      });
    }
  }
  const journal = JSON.parse(
    readFileSync(join(root, "drizzle/migrations/meta/_journal.json"), "utf8"),
  );
  for (const entry of journal.entries) {
    const stamp = new Date(entry.when).toISOString().replace(/\D/g, "").slice(0, 14);
    rows.push({
      key: `${stamp}b${entry.tag}`,
      path: join(root, "drizzle/migrations", `${entry.tag}.sql`),
      name: `${entry.tag}.sql`,
    });
  }
  return rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
