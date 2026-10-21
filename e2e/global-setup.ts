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
import { LEGAL_DOCUMENT_TYPES, currentVersion } from "../src/lib/legal-documents";

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

    // Every fixture account, not just the player. Specs sign in as e2e-host too,
    // and seeding only the player is why `e2e-host@lovable.test should be signed
    // in` failed across three spec files.
    //
    // Each gets an adult birthday. age_cohort_of() reads profiles.age_cohort,
    // which is derived from profile_birthdays by trigger and is 'unknown' until a
    // birthday exists — and 'unknown' is not an adult, so an account with no
    // birthday cannot host (block_child_hosting) and is treated as a minor by the
    // child-safety policies the fixture flows exercise.
    const ADULT_BIRTHDAY = "1990-05-04";

    async function upsertAccount(acct: {
      email: string;
      password: string;
      displayName: string;
    }): Promise<string | null> {
      const metadata = {
        display_name: acct.displayName,
        name: acct.displayName,
        full_name: acct.displayName,
        // Explicit, so seeding does not depend on the handle_new_user fix in
        // 20260911001000 having been applied to the target project yet. That
        // trigger writes profiles.account_type straight from this value, and the
        // column is NOT NULL, so an absent account_type fails the whole insert as
        // "Database error creating new user" — which is what blocked CI seeding.
        // Naming it here is also just more honest about what these fixtures are.
        account_type: "player",
        // Reset every run. The existing metadata is merged in below, and a
        // Parent / Guardian pick in the onboarding picker once wrote
        // is_guardian: true to the real e2e-player account. That flag never
        // cleared, so the account ran in Parent Mode from then on: /profile
        // redirected to /parent, /games/$id/pay to /guardian, and the join and
        // pay CTAs were hidden on every game page.
        is_guardian: false,
      };
      try {
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        if (listErr) throw new Error(listErr.message);
        const existing = list.users.find(
          (u) => u.email?.toLowerCase() === acct.email.toLowerCase(),
        );

        let id: string | null = existing?.id ?? null;
        if (!existing) {
          const { data: created, error } = await admin.auth.admin.createUser({
            email: acct.email,
            password: acct.password,
            email_confirm: true,
            user_metadata: metadata,
          });
          if (error && !/already/i.test(error.message)) throw error;
          id = created?.user?.id ?? null;
        } else {
          await admin.auth.admin.updateUserById(existing.id, {
            password: acct.password,
            email_confirm: true,
            user_metadata: { ...(existing.user_metadata ?? {}), ...metadata },
          });
        }

        if (id) {
          const { error: bErr } = await admin
            .from("profile_birthdays")
            .upsert({ user_id: id, birthday: ADULT_BIRTHDAY }, { onConflict: "user_id" });
          if (bErr) {
            console.warn(
              `[e2e global-setup] Could not set birthday for ${acct.email}: ${bErr.message}`,
            );
          }
          // handle_new_user only writes account_type when the account is
          // created, so put it back in case an earlier run changed it.
          const { error: tErr } = await admin
            .from("profiles")
            .update({ account_type: "player" })
            .eq("id", id);
          if (tErr) {
            console.warn(
              `[e2e global-setup] Could not reset account_type for ${acct.email}: ${tErr.message}`,
            );
          }
        }
        return id;
      } catch (err) {
        console.warn(
          `[e2e global-setup] Could not upsert ${acct.email}: ${
            err instanceof Error ? err.message : String(err)
          }.`,
        );
        return null;
      }
    }

    const fixtureIds: string[] = [];
    for (const acct of TEST_ACCOUNTS) {
      const id = await upsertAccount(acct);
      if (id) fixtureIds.push(id);
    }

    // (2a) Record the fixture accounts' acceptance of the current Terms and
    // Privacy Policy. The 2026-09-01 versions are material, so an account that
    // never accepted them gets LegalReacceptGate: a full-screen "Updated legal
    // documents" dialog over every tab route that intercepts every click (the
    // FilterBar specs failed on exactly that in run 288). The fixtures stand in
    // for returning members who already agreed.
    //
    // Same versions effectiveVersion() shows: a published legal_documents row
    // wins, the bundled registry is the fallback. Both are accepted.
    if (fixtureIds.length > 0) {
      try {
        const versions = new Map<string, Set<string>>(
          LEGAL_DOCUMENT_TYPES.map(
            (type) => [type, new Set([currentVersion(type).version])] as const,
          ),
        );
        const { data: published, error: docsErr } = await admin
          .from("legal_documents")
          .select("document_type, version")
          .eq("published", true);
        if (docsErr) {
          console.warn(
            `[e2e global-setup] Could not read published legal documents: ${docsErr.message}. ` +
              "Accepting the bundled versions only.",
          );
        }
        for (const row of (published ?? []) as { document_type: string; version: string }[]) {
          versions.get(row.document_type)?.add(row.version);
        }
        const rows = fixtureIds.flatMap((user_id) =>
          [...versions].flatMap(([document_type, set]) =>
            [...set].map((document_version) => ({
              user_id,
              document_type,
              document_version,
              user_agent: "e2e global-setup",
            })),
          ),
        );
        const { error } = await admin.from("legal_consents").upsert(rows, {
          onConflict: "user_id,document_type,document_version",
          ignoreDuplicates: true,
        });
        if (error) throw new Error(error.message);
      } catch (err) {
        console.warn(
          `[e2e global-setup] Could not record legal consent for the fixture accounts: ${
            err instanceof Error ? err.message : String(err)
          }. The "Updated legal documents" dialog will cover tab routes.`,
        );
      }
    }

    // (2b) Seed the fixed "g1"/"g2" hosted_games rows a large chunk of the suite
    // hardcodes as a lightweight fixture game.
    //
    // These used to use a synthetic host_id that belonged to nobody. host_id has
    // no FK so the row inserted, but block_child_hosting rejects it:
    // age_cohort_of() resolves an unknown id to 'unknown', which is not an adult,
    // so the seed died with CHILD_CANNOT_HOST and every spec hardcoding g1/g2
    // failed. The host has to be a real account with an adult birthday.
    //
    // It is a dedicated account rather than one of the three above, so that no
    // spec ever signs in as the host of these games and isHost stays false
    // everywhere — the property the old synthetic id was there to provide.
    const gamesHostId = await upsertAccount({
      email: "e2e-games-host@lovable.test",
      password: "E2E-games-host-pass-2026!",
      displayName: "E2E Games Host",
    });

    if (!gamesHostId) {
      console.warn(
        "[e2e global-setup] No games host account; skipping g1/g2. Specs that hardcode these ids will fail.",
      );
    } else {
      try {
        const now = Date.now();
        const rows = [
          {
            id: "g1",
            host_id: gamesHostId,
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
            host_id: gamesHostId,
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
