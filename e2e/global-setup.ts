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
import { readFileSync } from "node:fs";
import type { FullConfig } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  LEGAL_DOCUMENT_LIST,
  effectiveVersion,
  type PublishedLegalDocument,
} from "../src/lib/legal-documents";
import { TEST_ACCOUNTS } from "../src/lib/test-fixtures";
import { assertLaunchedDevServer } from "./safety/dev-server";
import {
  assertSafeE2eTarget,
  documentedProductionRefs,
  verifyServedAppTarget,
} from "./safety/target-guard";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_PROJECT_ID = process.env.SUPABASE_PROJECT_ID ?? process.env.VITE_SUPABASE_PROJECT_ID;

export default async function globalSetup(config?: Pick<FullConfig, "webServer">) {
  // First statement, before the pass-through below, any client, any write.
  // playwright.config.ts has already run the environment check; this repeats it
  // (a setup file must not rely on its caller) and adds the one check only a
  // running process can make: which backend the served app itself will use.
  const target = assertSafeE2eTarget(
    process.env,
    documentedProductionRefs((path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    }),
  );
  // The dev server must be the one playwright.config.ts launched from the verified
  // environment. A config that drops the webServer, reuses a running server or
  // starts anything else is refused: nothing then proves what the server's own
  // SUPABASE_* variables are.
  assertLaunchedDevServer(config?.webServer);
  await verifyServedAppTarget(
    process.env.E2E_BASE_URL ?? "http://localhost:8080",
    target,
    (url) => fetch(url),
    { publishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY },
  );

  // The service role key is read once, here, AFTER the guard above has validated it, and
  // removed from the environment so the spec workers Playwright starts next, and
  // their children, never inherit it. The web server (already started by now) received
  // it through the launcher's inherited environment, not through the serialized config.
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

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

    // The current Terms and Privacy versions, as the app computes them (a published
    // legal_documents row, else the bundled version). An account that has not accepted a
    // material version gets the full-screen LegalReacceptGate on every signed-in page, which
    // covers whatever a spec is trying to click. The shared sandbox's fixtures accepted long
    // ago; a fresh database (e2e/local-stack) has no consent rows at all. So record the
    // acceptance a user would give by ticking the gate. ignoreDuplicates leaves existing rows
    // untouched.
    let published: PublishedLegalDocument[] = [];
    {
      const { data, error } = await admin
        .from("legal_documents")
        .select(
          "id, document_type, title, version, content, summary, requires_reacceptance, effective_date, published, published_at, archived_at",
        )
        .not("published_at", "is", null)
        .order("effective_date", { ascending: false });
      if (error) {
        console.warn(
          `[e2e global-setup] Could not read published legal documents (${error.message}); using the bundled versions.`,
        );
      } else published = (data ?? []) as PublishedLegalDocument[];
    }
    const currentLegal = LEGAL_DOCUMENT_LIST.map((doc) => ({
      document_type: doc.type,
      document_version: effectiveVersion(doc.type, published).version,
    }));

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
        // Specs that exercise the guardian onboarding path flip this flag on the
        // shared fixture, and it used to stick across runs because this metadata
        // is merged over what exists. A guardian fixture is in Parent Mode, which
        // hides every join and pay control on a game page, so reset it each run.
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
          const { error: cErr } = await admin.from("legal_consents").upsert(
            currentLegal.map((c) => ({ ...c, user_id: id })),
            { onConflict: "user_id,document_type,document_version", ignoreDuplicates: true },
          );
          if (cErr) {
            console.warn(
              `[e2e global-setup] Could not record legal acceptance for ${acct.email}: ${cErr.message}. ` +
                "Signed-in specs may be blocked by the legal re-accept dialog.",
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

    for (const acct of TEST_ACCOUNTS) await upsertAccount(acct);

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
        // Never overwrite a game this suite did not create. The ids are fixed and
        // short, so a project that already has a real "g1" must keep it: only
        // rows that are absent, or already owned by the fixture host, are written.
        const { data: existing, error: readErr } = await admin
          .from("hosted_games")
          .select("id, host_id")
          .in(
            "id",
            rows.map((r) => r.id),
          );
        if (readErr) throw new Error(readErr.message);
        const foreign = new Set(
          (existing ?? []).filter((r) => r.host_id !== gamesHostId).map((r) => r.id as string),
        );
        for (const id of foreign) {
          console.warn(
            `[e2e global-setup] A game with id ${id} exists and is not owned by the fixture host; leaving it untouched.`,
          );
        }
        const writable = rows.filter((r) => !foreign.has(r.id));
        if (writable.length > 0) {
          const { error } = await admin.from("hosted_games").upsert(writable, { onConflict: "id" });
          if (error) throw new Error(error.message);
        }

        // The game page derives "requires approval" from game_payment_settings,
        // and FAILS CLOSED: with no settings row, `requiresApproval` defaults to
        // true (src/routes/games.$gameId.index.tsx), so the join CTA reads
        // "Request Spot" instead of "Join Run". The join-free specs on g1
        // (join-cross-device-*, join-realtime-*, roster-*) expect a free,
        // no-approval game, so seed a settings row that says so. g2 keeps the
        // default (approval-gated), which the invite/request specs rely on, and
        // the pay-* specs mock their own settings, so only g1 needs a row.
        const g1Writable = writable.some((r) => r.id === "g1");
        if (g1Writable) {
          const { error: psErr } = await admin
            .from("game_payment_settings")
            .upsert(
              { game_id: "g1", host_id: gamesHostId, entry_fee: 0, requires_approval: false },
              { onConflict: "game_id,host_id" },
            );
          if (psErr) {
            console.warn(
              `[e2e global-setup] Could not seed g1 payment settings (free, no approval): ${psErr.message}. ` +
                "join-free specs on g1 will see the approval-gated CTA and fail.",
            );
          }
        }
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

  // Clear is_guardian on the shared player fixture every run, with the session
  // we just minted (no service key needed). A guardian-onboarding spec can set
  // this flag on the account; once set it puts the player in Parent Mode, which
  // hides the join and pay controls and redirects /profile and /games/:id/pay
  // to /parent and /guardian, breaking every later join/pay spec. The
  // service-key seed above also resets it, but that branch is skipped without
  // the key (local runs), so reset it here too. The player is account_type
  // "player" with no managed children or guardian links, so this sticks.
  // Refresh afterwards so the session we inject carries the cleared metadata,
  // not the stale snapshot from sign-in (the app reads is_guardian from it).
  let session = data.session;
  if ((session.user.user_metadata as Record<string, unknown>)?.is_guardian === true) {
    const { error: guardianErr } = await client.auth.updateUser({ data: { is_guardian: false } });
    if (guardianErr) {
      console.warn(
        `[e2e global-setup] Could not clear is_guardian on ${player.email}: ${guardianErr.message}. ` +
          "If a guardian-onboarding spec set it, later join/pay specs may redirect to Parent Mode.",
      );
    } else {
      const { data: refreshed } = await client.auth.refreshSession();
      if (refreshed.session) session = refreshed.session;
    }
  }

  const storageKey = `sb-${SUPABASE_PROJECT_ID}-auth-token`;
  process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY = storageKey;
  process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON = JSON.stringify(session);
  process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN = session.access_token;
  process.env.LOVABLE_BROWSER_AUTH_STATUS = "injected";

  console.log(`[e2e global-setup] Signed in ${player.email} for E2E specs.`);
}
