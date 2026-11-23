import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { effectiveVersion, type PublishedLegalDocument } from "../../src/lib/legal-documents";
import type { LocalStack } from "./local-only";

/**
 * Seeding for the managed-account handover tests that run against the LOCAL Docker stack only (e2e/local-stack/local-only.ts
 * makes the caller prove that before it can build one). Shared by the vitest integration test
 * (managed-handover-real-auth.itest.ts) and the Playwright spec (e2e/managed-handover-real-auth.spec.ts).
 *
 * It creates a managed account the way the app does (the Admin API call of `createManagedChild`, then the guardian's own token
 * calls `provision_managed_child`), and then makes its person an adult: a person only becomes a known adult by birthday, and
 * the app can never move a stored birthday (a support-approved correction is the only way, via `openrun.birthday_review`), so
 * psql, as the owner of the throwaway database, moves it inside one transaction that sets that setting.
 */

export type Scenario = {
  guardianId: string;
  guardianEmail: string;
  guardianPassword: string;
  childId: string;
  /** The managed placeholder address the account was created with. */
  placeholder: string;
  /** The adult's own address: where the handover is started for. */
  adultEmail: string;
  /** The guardian, signed in with their own password. */
  guardian: SupabaseClient;
};

export const rand = () => globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);

/** The same as hashHandoverToken in src/lib/managed-handover.server.ts (the itest asserts they agree). */
export function hashToken(token: string): string {
  return createHash("sha256").update(`openrun-handover:${token}`).digest("hex");
}

export function jwtClaims(accessToken: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString("utf8"));
}

export function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

/** What a supabase-js auth result holds once its error case is excluded (its failure branches carry `user: null`). */
type Ok<D> = D extends { user: null } ? never : NonNullable<D>;

/** The data of a supabase-js result, or a thrown error naming `what` (supabase-js results are a union of data-or-error). */
export function must<R extends { data: unknown; error: { message: string } | null }>(
  r: R,
  what: string,
): Ok<R["data"]> {
  if (r.error || r.data == null) throw new Error(`${what}: ${r.error?.message ?? "no data"}`);
  return r.data as Ok<R["data"]>;
}

/** The managed placeholder address (`managedEmailFor` in src/lib/managed-children.ts; the itest asserts `isManagedEmail`). */
export const placeholderEmail = () => `m${rand()}${rand()}@managed.invalid`;

export function createSeed(stack: LocalStack) {
  const client = (key = stack.publishableKey): SupabaseClient =>
    createClient(stack.url, key, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });
  const admin = client(stack.serviceRoleKey);

  /** SQL as the owner of the throwaway database (the password is the one `up` wrote to the git-ignored .state). */
  function localSql(sql: string): string {
    const env = readFileSync(
      fileURLToPath(new URL("./.state/compose.env", import.meta.url)),
      "utf8",
    );
    const password = /^LOCAL_DB_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim();
    const port = /^LOCAL_DB_PORT=(.*)$/m.exec(env)?.[1]?.trim() || "54322";
    if (!password) throw new Error("no LOCAL_DB_PASSWORD in e2e/local-stack/.state/compose.env");
    const r = spawnSync("psql", ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], {
      input: sql,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "",
        PGHOST: "127.0.0.1",
        PGPORT: port,
        PGUSER: "postgres",
        PGDATABASE: "postgres",
        PGPASSWORD: password,
        PGCONNECT_TIMEOUT: "5",
      },
    });
    if (r.status !== 0) {
      throw new Error(`psql failed: ${(r.stderr || r.error?.message || "").trim()}`);
    }
    return r.stdout.trim();
  }

  /** A guardian, and a managed account made the way the app makes one (a minor), whose person is then an adult. */
  async function seedManagedAdult(adultBirthdayYears = 19): Promise<Scenario> {
    const tag = rand();
    const guardianEmail = `realauth-guardian-${tag}@example.test`;
    const guardianPassword = `Guardian-${tag}-pw1!`;
    const g = must(
      await admin.auth.admin.createUser({
        email: guardianEmail,
        password: guardianPassword,
        email_confirm: true,
        user_metadata: { display_name: "Gale Guardian", account_type: "parent" },
      }),
      "create guardian",
    ).user;
    must(
      await admin
        .from("profile_birthdays")
        .upsert({ user_id: g.id, birthday: yearsAgo(40) }, { onConflict: "user_id" })
        .select("user_id"),
      "guardian birthday",
    );
    const guardian = client();
    must(
      await guardian.auth.signInWithPassword({ email: guardianEmail, password: guardianPassword }),
      "guardian sign-in",
    );

    // createManagedChild, step for step: an address that cannot receive mail, confirmed, no password, app_metadata says managed.
    const placeholder = placeholderEmail();
    const child = must(
      await admin.auth.admin.createUser({
        email: placeholder,
        email_confirm: true,
        user_metadata: { display_name: "Player", account_type: "player" },
        app_metadata: { managed: true, managed_by: g.id },
      }),
      "create managed account",
    ).user;
    const docs = must(
      await guardian
        .from("legal_documents")
        .select(
          "id, document_type, title, version, content, summary, requires_reacceptance, effective_date, published, published_at, archived_at",
        )
        .not("published_at", "is", null)
        .order("effective_date", { ascending: false }),
      "legal documents",
    ) as unknown as PublishedLegalDocument[];
    const prov = await guardian.rpc("provision_managed_child", {
      _child: child.id,
      _dob: yearsAgo(15),
      _display_name: "Sam",
      _relationship: "parent",
      _versions: {
        terms: effectiveVersion("terms", docs).version,
        privacy: effectiveVersion("privacy", docs).version,
      },
      _attested: true,
    });
    if (prov.error) throw new Error(`provision_managed_child: ${prov.error.message}`);

    // Time passes: the person is now an adult.
    localSql(
      `BEGIN; SET LOCAL openrun.birthday_review = 'on';
       UPDATE public.profile_birthdays SET birthday = '${yearsAgo(adultBirthdayYears)}' WHERE user_id = '${child.id}';
       COMMIT;`,
    );
    return {
      guardianId: g.id,
      guardianEmail,
      guardianPassword,
      childId: child.id,
      placeholder,
      adultEmail: `realauth-adult-${tag}@example.test`,
      guardian,
    };
  }

  /** What startManagedSession does, then what the browser does with the result: the guardian becomes the child. */
  async function switchIn(
    placeholder: string,
  ): Promise<{ client: SupabaseClient; session: Session }> {
    const link = must(
      await admin.auth.admin.generateLink({ type: "magiclink", email: placeholder }),
      "magic link for the managed account",
    );
    const c = client();
    const v = await c.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: "magiclink",
    });
    if (v.error || !v.data.session) throw new Error(`switch-in verifyOtp: ${v.error?.message}`);
    return { client: c, session: v.data.session };
  }

  /**
   * What `startManagedHandover` does against the database (it then emails the link: Lovable's mail API, which cannot run
   * here). The service role, the guardian's id, only the token's hash.
   */
  async function startHandover(
    s: Scenario,
    token: string,
    hash: (t: string) => string = hashToken,
  ) {
    const r = await admin.rpc(
      "start_managed_handover" as never,
      {
        _guardian: s.guardianId,
        _child: s.childId,
        _email: s.adultEmail,
        _token_hash: hash(token),
      } as never,
    );
    if (r.error) throw new Error(`start_managed_handover: ${r.error.message}`);
    if ((r.data as { ok?: boolean }).ok !== true) {
      throw new Error(`start_managed_handover refused: ${JSON.stringify(r.data)}`);
    }
  }

  return { client, admin, localSql, seedManagedAdult, switchIn, startHandover };
}
