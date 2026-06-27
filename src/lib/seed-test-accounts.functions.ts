import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TEST_ACCOUNTS } from "./test-fixtures";

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

      if (!user) {
        const { data: createRes, error: createErr } =
          await supabaseAdmin.auth.admin.createUser({
            email: acct.email,
            password: acct.password,
            email_confirm: true,
            user_metadata: { display_name: acct.displayName },
          });
        if (createErr) throw new Error(`createUser ${acct.email}: ${createErr.message}`);
        user = createRes.user!;
        created = true;
      } else {
        // Ensure password matches fixture so tests can sign in deterministically.
        await supabaseAdmin.auth.admin.updateUserById(user.id, {
          password: acct.password,
          email_confirm: true,
          user_metadata: { display_name: acct.displayName },
        });
      }

      // Upsert profile (handle_new_user trigger creates a base row; we enrich it)
      await supabaseAdmin
        .from("profiles")
        .upsert(
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
          },
          { onConflict: "id" },
        );

      results.push({ key: acct.key, email: acct.email, userId: user.id, created });
    }

    // Seed a hosted game for the host + availabilities for players (idempotent by tag)
    const host = results.find((r) => r.key === "host")!;
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
        await supabaseAdmin
          .from("player_availabilities")
          .update(payload)
          .eq("id", existing[0].id);
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
