/**
 * Playwright global setup: guarantee a signed-in Supabase session for the
 * reserved `e2e-session@lovable.test` fixture account and expose it to specs
 * via the same `LOVABLE_BROWSER_SUPABASE_*` env vars the pay-button specs
 * (and sandbox) already look for.
 *
 * Runs once before any spec. Env mutations here propagate to Playwright
 * worker processes because they inherit process.env at spawn time.
 *
 * The account is reserved (see SESSION_ACCOUNT_KEY) because this is a single
 * snapshot shared by ~40 specs for the whole run. It used to be `player`,
 * which the fixture-* specs also sign in and out of through the real form —
 * and `supabase.auth.signOut()` defaults to global scope, revoking every
 * refresh token for that user. That silently killed this snapshot mid-run, so
 * every injection spec ordered after those specs got 403s and bounced to
 * /auth. Nothing may sign this account in or out through the form.
 *
 * Flow:
 *  1. If the sandbox already injected a session, pass it through.
 *  2. Otherwise, if a service role key is available, upsert the session
 *     fixture account (idempotent) via the Admin API so CI runs work
 *     without a pre-seeded database.
 *  3. Sign in with the fixture credentials via the publishable key and
 *     export the session.
 *
 * Missing env → warn + return; the specs auto-skip as before.
 */
import { createClient } from "@supabase/supabase-js";
import { SESSION_ACCOUNT_KEY, TEST_ACCOUNTS } from "../src/lib/test-fixtures";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_PROJECT_ID = process.env.SUPABASE_PROJECT_ID ?? process.env.VITE_SUPABASE_PROJECT_ID;
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

  // The reserved session account — NOT `player`. Every spec that injects this
  // snapshot depends on its refresh token surviving the whole run, and
  // `supabase.auth.signOut()` defaults to global scope: the fixture-* specs
  // sign `player` out through the real form, which used to revoke this
  // snapshot and leave every later injection spec bouncing to /auth with 403s.
  const sessionAccount = TEST_ACCOUNTS.find((a) => a.key === SESSION_ACCOUNT_KEY)!;

  // (2) Best-effort idempotent seed when a service role key is available.
  if (SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
      });
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (listErr) throw new Error(listErr.message);
      const metadata = {
        display_name: sessionAccount.displayName,
        name: sessionAccount.displayName,
        full_name: sessionAccount.displayName,
      };
      const existing = list.users.find(
        (u) => u.email?.toLowerCase() === sessionAccount.email.toLowerCase(),
      );
      if (!existing) {
        const { error } = await admin.auth.admin.createUser({
          email: sessionAccount.email,
          password: sessionAccount.password,
          email_confirm: true,
          user_metadata: metadata,
        });
        if (error && !/already/i.test(error.message)) throw error;
      } else {
        await admin.auth.admin.updateUserById(existing.id, {
          password: sessionAccount.password,
          email_confirm: true,
          user_metadata: { ...(existing.user_metadata ?? {}), ...metadata },
        });
      }

      // Creating the auth user is not enough: AuthGate holds every protected
      // route until the account has a resolved age and an account_type, so a
      // fresh account would land on the age/onboarding step instead of the
      // surface under test. `seedTestAccounts` does this for its own runs;
      // do the same here, since CI only ever runs this file.
      const { data: after } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const seeded = after.users.find(
        (u) => u.email?.toLowerCase() === sessionAccount.email.toLowerCase(),
      );
      if (seeded) {
        await admin.from("profiles").upsert(
          {
            id: seeded.id,
            display_name: sessionAccount.displayName,
            avatar_initials: sessionAccount.displayName
              .split(" ")
              .map((s) => s[0])
              .join("")
              .slice(0, 2)
              .toUpperCase(),
            city: sessionAccount.city,
            account_type: "player",
          },
          { onConflict: "id" },
        );
        await admin
          .from("profile_birthdays")
          .upsert({ user_id: seeded.id, birthday: "1990-06-15" }, { onConflict: "user_id" });
      }
    } catch (err) {
      console.warn(
        `[e2e global-setup] Could not upsert fixture account: ${
          err instanceof Error ? err.message : String(err)
        }. Falling through to sign-in attempt.`,
      );
    }
  }

  // (3) Sign in with the publishable key to mint a real user session.
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const signIn = async (acct: (typeof TEST_ACCOUNTS)[number]) => {
    const { data, error } = await client.auth.signInWithPassword({
      email: acct.email,
      password: acct.password,
    });
    return error || !data.session ? null : data.session;
  };

  let session = await signIn(sessionAccount);
  let signedInAs = sessionAccount.email;

  // The reserved account has to exist before it can back the snapshot, and
  // provisioning it needs the service role key. Rather than skip ~130
  // auth-required specs when it is missing — silence reads as health — fall
  // back to the account that has historically been seeded. That reinstates the
  // mid-run revocation this split was made to fix, so say so loudly; the fix
  // engages on its own the moment the reserved account exists.
  if (!session) {
    const fallback = TEST_ACCOUNTS.find((a) => a.key === "player");
    if (fallback) {
      session = await signIn(fallback);
      if (session) {
        signedInAs = fallback.email;
        console.warn(
          `[e2e global-setup] ${sessionAccount.email} is not provisioned, so the injected ` +
            `session falls back to ${fallback.email}. Expect the fixture-* specs' global-scope ` +
            "sign-out to revoke it mid-run, failing every injected-session spec ordered after " +
            `them. Seed ${sessionAccount.email} (run seedTestAccounts, or set ` +
            "SUPABASE_SERVICE_ROLE_KEY so this file can provision it) to get the isolation back.",
        );
      }
    }
  }

  if (!session) {
    console.warn(
      `[e2e global-setup] Could not sign in ${sessionAccount.email}: no session. ` +
        "Set SUPABASE_SERVICE_ROLE_KEY (or pre-seed the account) so global-setup can provision it. " +
        "Auth-required specs will skip.",
    );
    return;
  }

  const storageKey = `sb-${SUPABASE_PROJECT_ID}-auth-token`;
  process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY = storageKey;
  process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON = JSON.stringify(session);
  process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN = session.access_token;
  process.env.LOVABLE_BROWSER_AUTH_STATUS = "injected";

  console.log(`[e2e global-setup] Signed in ${signedInAs} for E2E specs.`);
}
