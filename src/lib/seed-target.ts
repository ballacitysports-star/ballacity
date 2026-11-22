/**
 * Whether the test-account seed may write to the backend at `supabaseUrl`, which is the `SUPABASE_URL` the service-role
 * client (client.server.ts) talks to. The seed creates accounts with known passwords, so it fails closed: it runs only
 * on a local Supabase or on the E2E sandbox. Production, an unknown project and a missing URL are all refused.
 *
 * It names only the projects it allows. Production's project ref is deliberately not in this file: app code must not
 * carry it (CI fails the build if the production ref is anywhere in the build output). SEED_ALLOWED_PROJECT_REFS must
 * match NON_PRODUCTION_E2E_PROJECT_REFS in e2e/safety/target-guard.ts; seed-target.test.ts checks that.
 *
 * Returns null when seeding is allowed, else the reason it is refused.
 */
export const SEED_ALLOWED_PROJECT_REFS: readonly string[] = ["qkukefvzwlyusvspablz"];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export const SEED_TARGET_REFUSAL =
  "Test accounts can only be seeded on a local Supabase or the E2E sandbox, never in production.";

function seedTarget(raw: string): "local" | string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host)) return "local";
  const m = /^([a-z0-9]{20})\.supabase\.(co|in)$/.exec(host);
  return m ? m[1] : null;
}

export function seedTargetRefusal(supabaseUrl: string | undefined): string | null {
  const target = supabaseUrl?.trim() ? seedTarget(supabaseUrl) : null;
  if (target === "local") return null;
  if (target && SEED_ALLOWED_PROJECT_REFS.includes(target)) return null;
  return SEED_TARGET_REFUSAL;
}
