import { readFileSync } from "node:fs";
import { assertSafeE2eTarget, documentedProductionRefs, type Env } from "../safety/target-guard";

/**
 * Real-auth tests (`npm run test:realauth`, e2e/managed-handover-real-auth.spec.ts) create and change accounts through the auth
 * Admin API and hold passwords they set themselves. They are only ever safe against the throwaway Docker stack in
 * e2e/local-stack, so this is stricter than the E2E guard: the shared E2E sandbox is refused too, and so is anything that is
 * not a loopback URL. Each throws, naming the reason and no secret, for anything else.
 */
export type LocalTarget = { url: string; publishableKey: string };
export type LocalStack = LocalTarget & { serviceRoleKey: string };

const defaultRead = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** The local stack's URL and publishable key. A Playwright worker has no service-role key (global-setup removes it), so this is all a spec may ask for. */
export function requireLocalTarget(
  env: Env,
  readText: (path: string) => string | null = defaultRead,
): LocalTarget {
  // Same checks as every E2E run: both URLs set and agreeing, project label not a real reference, app served from localhost.
  const target = assertSafeE2eTarget(env, documentedProductionRefs(readText));
  if (target.kind !== "local") {
    throw new Error(
      "The real-auth tests run only against the local Docker stack (node e2e/local-stack/stack.mjs up), never the E2E sandbox.",
    );
  }
  const url = (env["SUPABASE_URL"] ?? "").trim();
  const publishableKey = (env["SUPABASE_PUBLISHABLE_KEY"] ?? "").trim();
  if (!publishableKey) {
    throw new Error(
      "SUPABASE_PUBLISHABLE_KEY of the local stack is not set (source e2e/local-stack/.state/env.sh).",
    );
  }
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    /* refused below */
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error("SUPABASE_URL is not a loopback address; the real-auth tests refuse to run.");
  }
  return { url, publishableKey };
}

/** The same, plus the service-role key the test process needs to seed accounts. */
export function requireLocalStack(
  env: Env,
  readText: (path: string) => string | null = defaultRead,
): LocalStack {
  const local = requireLocalTarget(env, readText);
  const serviceRoleKey = (env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY of the local stack is not set (source e2e/local-stack/.state/env.sh).",
    );
  }
  return { ...local, serviceRoleKey };
}
