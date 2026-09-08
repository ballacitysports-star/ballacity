/**
 * Playwright global setup: guarantee a signed-in Supabase session for the
 * seeded `e2e-player@lovable.test` fixture account and expose it to specs
 * via the same `LOVABLE_BROWSER_SUPABASE_*` env vars the pay-button specs
 * (and sandbox) already look for.
 *
 * Runs once before any spec. Env mutations here propagate to Playwright
 * worker processes because they inherit process.env at spawn time.
 *
 * Flow:
 *  1. If the sandbox already injected a session, pass it through.
 *  2. Otherwise, if a service role key is available, upsert the player
 *     fixture account (idempotent) via the Admin API so CI runs work
 *     without a pre-seeded database.
 *  3. Sign in with the fixture credentials via the publishable key and
 *     export the session.
 *
 * Missing env → warn + return; the specs auto-skip as before.
 */
import { createClient } from "@supabase/supabase-js";
import { TEST_ACCOUNTS } from "../src/lib/test-fixtures";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_PROJECT_ID =
  process.env.SUPABASE_PROJECT_ID ?? process.env.VITE_SUPABASE_PROJECT_ID;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function globalSetup() {
  if (
    process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON &&
    process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY
  ) {
    // Sandbox already injected a session — pass through.
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_PROJECT_ID) {
    console.warn(
      "[e2e global-setup] Missing SUPABASE_URL / _PUBLISHABLE_KEY / _PROJECT_ID — session-required specs will skip.",
    );
    return;
  }

  const player = TEST_ACCOUNTS.find((a) => a.key === "player")!;

  // Everything below — the fixture accounts and the g1/g2 games — is gated on
  // the service role key. Without it none of it runs, and until now that was
  // silent: the only warning about seeding lived *inside* the same branch, so
  // a missing key produced no message at all, just dozens of specs failing
  // later with "element not found".
  //
  // 41 spec files hardcode the ids g1/g2. Verified against the project on
  // 2026-09-08: hosted_games held only the two real games, so the seed had
  // never run in CI, where this variable is empty. That is why merging the
  // seeding change in #6 did not clear the invite/pay cluster — the code it
  // added sits in this branch and never executed.
  //
  // Say so once, loudly, at the top of the run and in the job summary, so the
  // cause is visible where the failures are read rather than inferred from
  // them.
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    const msg =
      "SUPABASE_SERVICE_ROLE_KEY is not set. Fixture accounts and the g1/g2 " +
      "fixture games will NOT be seeded, and the 41 spec files that hardcode " +
      "those ids will fail with missing-element errors. Set it as a repository " +
      "secret to fix this class of failure.";
    console.warn(`\n[e2e global-setup] ${msg}\n`);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      const { appendFileSync } = await import("node:fs");
      appendFileSync(summary, `### E2E setup\n\n> **${msg}**\n\n`);
    }
  }

  // (2) Best-effort idempotent seed when a service role key is available.
  if (SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });

    try {
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (listErr) throw new Error(listErr.message);
      const metadata = {
        display_name: player.displayName,
        name: player.displayName,
        full_name: player.displayName,
      };
      const existing = list.users.find(
        (u) => u.email?.toLowerCase() === player.email.toLowerCase(),
      );
      if (!existing) {
        const { error } = await admin.auth.admin.createUser({
          email: player.email,
          password: player.password,
          email_confirm: true,
          user_metadata: metadata,
        });
        if (error && !/already/i.test(error.message)) throw error;
      } else {
        await admin.auth.admin.updateUserById(existing.id, {
          password: player.password,
          email_confirm: true,
          user_metadata: { ...(existing.user_metadata ?? {}), ...metadata },
        });
      }
    } catch (err) {
      console.warn(
        `[e2e global-setup] Could not upsert fixture account: ${
          err instanceof Error ? err.message : String(err)
        }. Falling through to sign-in attempt.`,
      );
    }

    // (2b) Seed the fixed "g1"/"g2" hosted_games rows a large chunk of the
    // suite hardcodes as a lightweight, DB-free fixture game. These used to
    // be served from a bundled sample-data fallback; that fallback is now
    // empty (real users no longer see demo games), so the specs need a real
    // row instead. host_id has no FK, so any UUID that isn't the signed-in
    // player's own id keeps isHost false — no second fixture account needed.
    try {
      const now = Date.now();
      const rows = [
        {
          id: "g1",
          host_id: "00000000-0000-4000-8000-000000000001",
          sport: "Basketball",
          title: "Friday Night Run · 5v5 Full Court",
          date: new Date(now + 3 * 3600_000).toISOString(),
          duration: "120 min",
          location: "Tompkins Square Courts",
          neighborhood: "East Village",
          max_players: 10,
          joined: 8,
          skill: "Intermediate",
          price: 0,
          indoor: false,
          is_private: false,
          description:
            "Competitive but chill. We rotate teams every game to 11. Bring a light + dark shirt.",
          host_snapshot: { name: "Marcus Lee", username: "@marcus", avatar: "ML", rating: 4.9 },
        },
        {
          id: "g2",
          host_id: "00000000-0000-4000-8000-000000000002",
          sport: "Soccer",
          title: "Sunday Sunset 7v7",
          date: new Date(now + 22 * 3600_000).toISOString(),
          duration: "90 min",
          location: "Pier 40 Turf",
          neighborhood: "West Side",
          max_players: 14,
          joined: 11,
          skill: "All Levels",
          price: 8,
          indoor: false,
          is_private: false,
          description: "Mixed-gender, all levels. $8 covers turf rental. Cleats recommended.",
          host_snapshot: { name: "Ana García", username: "@anagk", avatar: "AG", rating: 4.8 },
        },
      ];
      const { error } = await admin.from("hosted_games").upsert(rows, { onConflict: "id" });
      if (error) throw new Error(error.message);
    } catch (err) {
      console.warn(
        `[e2e global-setup] Could not seed fixture games g1/g2: ${
          err instanceof Error ? err.message : String(err)
        }. Specs that hardcode these ids will fail.`,
      );
    }
  }

  // (3) Sign in with the publishable key to mint a real user session.
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: player.email,
    password: player.password,
  });
  if (error || !data.session) {
    console.warn(
      `[e2e global-setup] Could not sign in ${player.email}: ${error?.message ?? "no session"}. ` +
        "Set SUPABASE_SERVICE_ROLE_KEY (or pre-seed the account) so global-setup can provision it. " +
        "Auth-required specs will skip.",
    );
    return;
  }

  const storageKey = `sb-${SUPABASE_PROJECT_ID}-auth-token`;
  process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY = storageKey;
  process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON = JSON.stringify(data.session);
  process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN = data.session.access_token;
  process.env.LOVABLE_BROWSER_AUTH_STATUS = "injected";

  console.log(`[e2e global-setup] Signed in ${player.email} for E2E specs.`);
}
