import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TEST_ACCOUNTS } from "./test-fixtures";

/** Every fixture account is a clear adult so onboarding's age step is settled. */
const FIXTURE_ADULT_BIRTHDAY = "1990-06-15";

/**
 * Idempotently seeds the test fixture accounts in Supabase Auth + profiles
 * and creates a sample player availability for each "player" account plus
 * a sample hosted game for the host. Safe to re-run.
 *
 * Admin-only. Intended for setting up multi-user notification E2E flows.
 */
export const seedTestAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Admin gate
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const results: Array<{
      key: string;
      email: string;
      userId: string;
      created: boolean;
    }> = [];

    for (const acct of TEST_ACCOUNTS) {
      // Find existing user by email (paginate up to 1000 — enough for fixtures)
      const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (listErr) throw new Error(`listUsers failed: ${listErr.message}`);

      let user = list.users.find((u) => u.email?.toLowerCase() === acct.email.toLowerCase());
      let created = false;

      // Always include both `display_name` and `name` so every consumer
      // (handle_new_user trigger, host snapshot resolver, E2E specs that read
      // user_metadata.display_name) finds a non-empty value — and never
      // degrades to the email prefix.
      const metadata = {
        display_name: acct.displayName,
        name: acct.displayName,
        full_name: acct.displayName,
      };

      if (!user) {
        const { data: createRes, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email: acct.email,
          password: acct.password,
          email_confirm: true,
          user_metadata: metadata,
        });
        if (createErr) throw new Error(`createUser ${acct.email}: ${createErr.message}`);
        user = createRes.user!;
        created = true;
      } else {
        // Merge with any existing metadata so we never strip unrelated fields,
        // but force the display_name keys to the fixture values.
        const merged = { ...(user.user_metadata ?? {}), ...metadata };
        await supabaseAdmin.auth.admin.updateUserById(user.id, {
          password: acct.password,
          email_confirm: true,
          user_metadata: merged,
        });
      }

      // Upsert profile (handle_new_user trigger creates a base row; we enrich it)
      await supabaseAdmin.from("profiles").upsert(
        {
          id: user.id,
          display_name: acct.displayName,
          avatar_initials: acct.displayName
            .split(" ")
            .map((s) => s[0])
            .join("")
            .slice(0, 2)
            .toUpperCase(),
          city: acct.city,
          account_type: "player",
        },
        { onConflict: "id" },
      );

      // Fixture accounts are adults. Without a stored birthday every sign-in
      // lands on the age step of onboarding instead of the app, so E2E specs
      // never reach the surface under test.
      await supabaseAdmin
        .from("profile_birthdays")
        .upsert({ user_id: user.id, birthday: FIXTURE_ADULT_BIRTHDAY }, { onConflict: "user_id" });

      results.push({ key: acct.key, email: acct.email, userId: user.id, created });
    }

    // Seed a hosted game for the host + availabilities for players (idempotent by tag)
    const players = results.filter((r) => r.key.startsWith("player"));

    // Player availabilities: one per player, tagged in notes so we can find/replace.
    for (const p of players) {
      const acct = TEST_ACCOUNTS.find((a) => a.key === p.key)!;
      const today = new Date();
      const inAWeek = new Date(Date.now() + 7 * 24 * 3600 * 1000);
      const isoDate = (d: Date) => d.toISOString().slice(0, 10);

      const { data: existing } = await supabaseAdmin
        .from("player_availabilities")
        .select("id")
        .eq("user_id", p.userId)
        .like("note", "%[e2e-fixture]%")
        .limit(1);

      const payload = {
        user_id: p.userId,
        sports: [acct.sport],
        skill_level: acct.skill,
        city: acct.city,
        starts_on: isoDate(today),
        ends_on: isoDate(inAWeek),
        note: "Looking to play — [e2e-fixture]",
        status: "open",
      };

      if (existing && existing.length > 0) {
        await supabaseAdmin.from("player_availabilities").update(payload).eq("id", existing[0].id);
      } else {
        await supabaseAdmin.from("player_availabilities").insert(payload);
      }
    }

    return {
      ok: true,
      accounts: results,
      note: "Sign in with the credentials in src/lib/test-fixtures.ts to run multi-user flows.",
    };
  });
