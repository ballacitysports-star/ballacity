/**
 * The managed-account handover against a REAL auth server (docs/managed-account-handover.md section 6).
 *
 * Everything else that tests the handover uses mocks (src/lib/managed-handover.server.test.ts) or a few lines of stub
 * schema (supabase/tests/991_managed_account_handover.test.sql). This file runs the app's real server code
 * (`completeHandover`, `lookupHandover`, `newHandoverToken`, `hashHandoverToken` from src/lib/managed-handover.server.ts)
 * with its real service-role client against the local Docker stack (real GoTrue, PostgREST and Postgres with every
 * migration applied), and signs in with the real client the way a browser does.
 *
 *   node e2e/local-stack/stack.mjs up
 *   set -a; . e2e/local-stack/.state/env.sh; set +a
 *   npx vitest run -c vitest.realauth.config.ts          (npm run test:realauth)
 *
 * It is not part of `vitest run` (the name ends `.itest.ts`) or of Playwright, and it refuses to start unless the
 * environment names the local stack (local-only.ts): it creates accounts, sets passwords and changes sign-in records.
 *
 * What stands in for what the app does that cannot run here:
 *   - The email. The app sends the link with sendTemplateEmail (Lovable's mail API, needs LOVABLE_API_KEY) and the local
 *     stack has no mail catcher (GoTrue sends nothing). The test makes the token with the real `newHandoverToken`, starts the
 *     handover with the same `start_managed_handover` call `startManagedHandover` makes (service role, the guardian's id,
 *     only the token's hash) and follows the link by passing the token to `completeHandover`, which is all the page does.
 *   - Creating the managed account: the same Admin API call `createManagedChild` makes, then the guardian's own token calls
 *     `provision_managed_child` (the server function itself needs the TanStack request context).
 *   - Becoming an adult: a person only becomes a known adult by birthday, and the app can never move a stored birthday (a
 *     support-approved correction is the only way, openrun.birthday_review). So the test moves the birthday of the managed
 *     minor 19 years back with psql, as the database owner of the throwaway stack, inside one transaction that sets that setting.
 */
import { type Session, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isManagedEmail, isManagedUser } from "@/lib/managed-children";
import {
  createSeed,
  hashToken,
  jwtClaims,
  must,
  placeholderEmail,
  rand,
  type Scenario,
} from "./handover-seed";
import { requireLocalStack } from "./local-only";

const stack = requireLocalStack(process.env);
const { client, admin, localSql, seedManagedAdult, switchIn, startHandover } = createSeed(stack);

async function signInResult(email: string, password: string) {
  const c = client();
  const r = await c.auth.signInWithPassword({ email, password });
  return { ok: !r.error && !!r.data.session, error: r.error?.message ?? null, data: r.data };
}

const seen: Record<string, unknown> = {};

afterAll(() => {
  // What was observed, for docs/managed-account-handover.md section 6 (secrets are never printed).
  console.log(`[real-auth] observed: ${JSON.stringify(seen, null, 2)}`);
});

describe("the local stack is the real thing", () => {
  it("answers as GoTrue and carries the migration under test", async () => {
    const health = await fetch(`${stack.url}/auth/v1/health`, {
      headers: { apikey: stack.publishableKey },
    });
    expect(health.ok).toBe(true);
    const body = (await health.json()) as { name?: string; version?: string };
    expect(body.name).toBe("GoTrue");
    seen["gotrue"] = body.version;
    // The twelve functions of 20261128100000 exist (a signed-out call is refused, not "not found").
    const probe = await client().rpc("guardian_managed_handovers" as never);
    expect(probe.error?.code, "migration 20261128100000 is not applied").not.toBe("PGRST202");
  });
});

describe("the seeding helpers agree with the app", () => {
  it("hashes a token as the app does and makes placeholder addresses the app recognises as managed", async () => {
    const mod = await import("@/lib/managed-handover.server");
    const token = mod.newHandoverToken();
    expect(hashToken(token)).toBe(mod.hashHandoverToken(token));
    expect(isManagedEmail(placeholderEmail())).toBe(true);
  });
});

describe("(1) updateUserById({ email, email_confirm: true }) and a password sign-in", () => {
  it("replaces the placeholder address on the user and on the email identity, and the new address signs in", async () => {
    const placeholder = placeholderEmail();
    const adultEmail = `realauth-solo-${rand()}@example.test`;
    const password = `Chosen-${rand()}-pw1!`;
    const created = must(
      await admin.auth.admin.createUser({
        email: placeholder,
        email_confirm: true,
        user_metadata: { display_name: "Player", account_type: "player" },
        app_metadata: { managed: true, managed_by: globalThis.crypto.randomUUID() },
      }),
      "create",
    ).user;
    // A managed account has no password: nothing signs in to it.
    expect((await signInResult(placeholder, password)).ok).toBe(false);
    expect(created.identities?.map((i) => i.provider)).toEqual(["email"]);
    expect((created.identities?.[0]?.identity_data as Record<string, unknown>)?.["email"]).toBe(
      placeholder,
    );

    const { error } = await admin.auth.admin.updateUserById(created.id, {
      email: adultEmail,
      email_confirm: true,
      password,
      app_metadata: { managed: false, managed_by: null },
    });
    expect(error).toBeNull();

    const after = must(await admin.auth.admin.getUserById(created.id), "read back").user;
    expect(after.email).toBe(adultEmail);
    expect(after.email_confirmed_at).toBeTruthy();
    const emailIdentity = after.identities?.find((i) => i.provider === "email");
    expect(emailIdentity, "an email identity").toBeTruthy();
    const idData = emailIdentity!.identity_data as Record<string, unknown>;
    seen["1_identity_after_update"] = {
      providers: after.identities?.map((i) => i.provider),
      identity_email_is_new_address: idData["email"] === adultEmail,
      identity_email_verified: idData["email_verified"],
    };
    expect(idData["email"]).toBe(adultEmail);
    // The row itself, as a later "sign in with Google" or "forgot password" would find it.
    const row = localSql(
      `SELECT concat_ws('|', (provider_id = user_id::text)::text, email, (SELECT email FROM auth.users WHERE id = '${created.id}')) FROM auth.identities WHERE user_id = '${created.id}' AND provider = 'email'`,
    );
    seen["1_identity_row"] = {
      provider_id_is_user_id: row.split("|")[0],
      identity_email_is_new: row.split("|")[1] === adultEmail,
      user_email_is_new: row.split("|")[2] === adultEmail,
    };
    expect(row).toBe(`true|${adultEmail}|${adultEmail}`);

    const ok = await signInResult(adultEmail, password);
    expect(ok.error).toBeNull();
    expect(ok.ok).toBe(true);
    expect(ok.data.user?.id).toBe(created.id);
    // The placeholder is gone as a way in.
    expect((await signInResult(placeholder, password)).ok).toBe(false);
    // Case does not matter, the way the app lower-cases the address it stores.
    expect((await signInResult(adultEmail.toUpperCase(), password)).ok).toBe(true);
  });
});

describe("(2) app_metadata.managed = false clears the claim in the signed JWT after a refresh", () => {
  it("a session opened as the managed account says managed; after the update and a refresh its JWT does not", async () => {
    const guardianId = globalThis.crypto.randomUUID();
    const placeholder = placeholderEmail();
    const child = must(
      await admin.auth.admin.createUser({
        email: placeholder,
        email_confirm: true,
        app_metadata: { managed: true, managed_by: guardianId },
      }),
      "create",
    ).user;
    const { client: c, session } = await switchIn(placeholder);
    const before = jwtClaims(session.access_token);
    const beforeMeta = before["app_metadata"] as Record<string, unknown>;
    expect(beforeMeta["managed"]).toBe(true);
    expect(beforeMeta["managed_by"]).toBe(guardianId);
    expect(isManagedUser({ app_metadata: beforeMeta })).toBe(true);

    const { error } = await admin.auth.admin.updateUserById(child.id, {
      app_metadata: { managed: false, managed_by: null },
    });
    expect(error).toBeNull();

    // A token already issued keeps what it was signed with: that is why the handover also deletes every session.
    expect(
      (jwtClaims(session.access_token)["app_metadata"] as Record<string, unknown>)["managed"],
    ).toBe(true);

    const refreshed = await c.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    const after = jwtClaims(refreshed.data.session!.access_token);
    const afterMeta = after["app_metadata"] as Record<string, unknown>;
    seen["2_claims_after_refresh"] = {
      app_metadata_keys: Object.keys(afterMeta).sort(),
      managed: afterMeta["managed"] ?? null,
      managed_by_present: "managed_by" in afterMeta,
    };
    expect(afterMeta["managed"]).not.toBe(true);
    expect(afterMeta["managed_by"] ?? null).toBeNull();
    expect(isManagedUser({ app_metadata: afterMeta })).toBe(false);
  });
});

describe("the whole handover, with the real server code", () => {
  const GUARDIAN_PASSWORD = "Planted-By-Guardian-1!";
  const ADULT_PASSWORD = "Chosen-By-The-Adult-1!";
  let s: Scenario;
  let token: string;
  let mod: typeof import("@/lib/managed-handover.server");
  let switched: { client: SupabaseClient; session: Session };
  let staleMagicLinkHash: string;
  let completed: { recoveryTokenHash: string | null; childUserId: string };

  beforeAll(async () => {
    mod = await import("@/lib/managed-handover.server");
    s = await seedManagedAdult();
    // The guardian switches in as the account (startManagedSession), and while there does what nothing but the app's pages
    // prevents: sets a password, and makes a magic link for later (a one-time token left in auth.one_time_tokens).
    switched = await switchIn(s.placeholder);
    const set = await switched.client.auth.updateUser({ password: GUARDIAN_PASSWORD });
    expect(
      set.error,
      `a switched-in guardian can set a password: ${set.error?.message}`,
    ).toBeNull();
    staleMagicLinkHash = must(
      await admin.auth.admin.generateLink({ type: "magiclink", email: s.placeholder }),
      "the guardian's own magic link",
    ).properties.hashed_token;
    token = mod.newHandoverToken();
    await startHandover(s, token);
  });

  it("before the adult confirms: the link looks up, and nothing about the account has changed", async () => {
    const look = await mod.lookupHandover(token);
    expect(look.valid).toBe(true);
    // The planted password signs in while the account is still managed (this is what completion must undo).
    expect((await signInResult(s.placeholder, GUARDIAN_PASSWORD)).ok).toBe(true);
    const rec = must(await admin.auth.admin.getUserById(s.childId), "record").user;
    expect(rec.email).toBe(s.placeholder);
    expect(isManagedEmail(rec.email)).toBe(true);
    expect(isManagedUser(rec)).toBe(true);
    const { count } = await admin
      .from("managed_accounts")
      .select("child_user_id", { count: "exact", head: true })
      .eq("child_user_id", s.childId);
    expect(count).toBe(1);
  });

  it("the adult follows the link: completeHandover runs every step against the real services", async () => {
    completed = await mod.completeHandover(token);
    expect(completed.childUserId).toBe(s.childId);
    seen["3_recovery_hash_returned"] = !!completed.recoveryTokenHash;
    expect(completed.recoveryTokenHash).toBeTruthy();

    const { count } = await admin
      .from("managed_accounts")
      .select("child_user_id", { count: "exact", head: true })
      .eq("child_user_id", s.childId);
    expect(count).toBe(0);
    const links = must(
      await admin.from("guardian_links").select("status").eq("child_user_id", s.childId),
      "links",
    );
    expect(links.map((l) => l.status)).toEqual(["revoked"]);
    const rec = must(await admin.auth.admin.getUserById(s.childId), "record").user;
    expect(rec.email).toBe(s.adultEmail);
    expect(isManagedUser(rec)).toBe(false);
    expect(await mod.lookupHandover(token)).toEqual({ valid: false, code: expect.any(String) });
  });

  it("(3) the recovery hashed_token starts the adult's own session with verifyOtp, once", async () => {
    const c = client();
    const v = await c.auth.verifyOtp({
      token_hash: completed.recoveryTokenHash!,
      type: "recovery",
    });
    expect(v.error).toBeNull();
    expect(v.data.session?.user.id).toBe(s.childId);
    expect(v.data.user?.email).toBe(s.adultEmail);
    const claims = jwtClaims(v.data.session!.access_token);
    const meta = claims["app_metadata"] as Record<string, unknown>;
    seen["3_recovery_session"] = {
      amr: claims["amr"],
      managed_in_jwt: meta["managed"] ?? null,
    };
    // (2, again, end to end) the adult's own session carries no managed claim.
    expect(meta["managed"]).not.toBe(true);
    expect(isManagedUser({ app_metadata: meta })).toBe(false);
    // The link works once.
    const again = await client().auth.verifyOtp({
      token_hash: completed.recoveryTokenHash!,
      type: "recovery",
    });
    expect(again.error).not.toBeNull();
    seen["3_second_use_error"] = again.error?.message;

    // The adult chooses a password in the browser, from that recovery session.
    const set = await c.auth.updateUser({ password: ADULT_PASSWORD });
    expect(set.error).toBeNull();
  });

  it("(1, (5)) the chosen password signs in with the adult's own address", async () => {
    const ok = await signInResult(s.adultEmail, ADULT_PASSWORD);
    expect(ok.error).toBeNull();
    expect(ok.data.user?.id).toBe(s.childId);
    const meta = jwtClaims(ok.data.session!.access_token)["app_metadata"] as Record<
      string,
      unknown
    >;
    expect(meta["managed"]).not.toBe(true);
  });

  it("(4) the guardian's switched-in session cannot refresh, or be used", async () => {
    const refreshed = await switched.client.auth.refreshSession();
    seen["4_refresh_after_finish"] = refreshed.error?.message ?? "REFRESHED";
    expect(refreshed.error).not.toBeNull();
    expect(refreshed.data.session).toBeNull();
    // The refresh token on its own, as someone who copied it would send it.
    const raw = await fetch(`${stack.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: stack.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: switched.session.refresh_token }),
    });
    expect(raw.ok).toBe(false);
    seen["4_raw_refresh_status"] = raw.status;
    // The access token the guardian still holds (valid for its hour as a signature, but its session is gone).
    const me = await fetch(`${stack.url}/auth/v1/user`, {
      headers: {
        apikey: stack.publishableKey,
        Authorization: `Bearer ${switched.session.access_token}`,
      },
    });
    seen["4_old_access_token_on_user_endpoint"] = me.status;
    const upd = await fetch(`${stack.url}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: stack.publishableKey,
        Authorization: `Bearer ${switched.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: "Guardian-Takes-Back-1!" }),
    });
    seen["4_old_access_token_updateUser_status"] = upd.status;
    expect(upd.ok).toBe(false);
    expect((await signInResult(s.adultEmail, "Guardian-Takes-Back-1!")).ok).toBe(false);
  });

  it("(4) a magic link the guardian made earlier no longer verifies", async () => {
    const v = await client().auth.verifyOtp({ token_hash: staleMagicLinkHash, type: "magiclink" });
    seen["4_old_magic_link"] = v.error?.message ?? "VERIFIED";
    expect(v.error).not.toBeNull();
    expect(v.data.session).toBeNull();
  });

  it("(4) the password the guardian set no longer signs in, by either address", async () => {
    expect((await signInResult(s.adultEmail, GUARDIAN_PASSWORD)).ok).toBe(false);
    expect((await signInResult(s.placeholder, GUARDIAN_PASSWORD)).ok).toBe(false);
  });

  it("the guardian cannot get back in: no managed account to switch into, and the link is spent", async () => {
    expect(mod.hashHandoverToken(token)).toHaveLength(64);
    const again = await mod.lookupHandover(token);
    expect(again.valid).toBe(false);
    await expect(mod.completeHandover(token)).rejects.toThrow();
  });
});

/**
 * The app's Admin API call (a throwaway password, the adult's address) already undoes much of what a switched-in guardian
 * can plant, and GoTrue ends every session when a password is changed that way. That would hide what the DATABASE does in
 * finish_managed_handover step 2b. So these scenarios run the app's steps one at a time (claim, the Admin API update,
 * finish) and, to test the database on its own, leave the throwaway password out of the update: then the guardian's session
 * is still alive between the update and finish (finish is what deletes sessions), can plant a password LATE, and only
 * finish_managed_handover can undo it. It runs on the real auth schema: real column names, real pgcrypto, real
 * one_time_tokens, identities and mfa_factors tables.
 */
describe("finish_managed_handover clears what a guardian planted, on the real auth schema", () => {
  const EARLY = "Planted-Early-By-Guardian-2!";
  const LATE = "Planted-Late-By-Guardian-3!";
  type Planted = {
    s: Scenario;
    token: string;
    hash: string;
    staleLink: string;
    guardianClient: SupabaseClient;
  };

  /** A managed adult whose switched-in guardian has added a phone, a linked OAuth identity, a second factor, a password and a magic link. */
  async function plant(mod: typeof import("@/lib/managed-handover.server")): Promise<Planted> {
    const s = await seedManagedAdult();
    // Contact details first: GoTrue drops outstanding magic links when they change (seen on 2.180.0), so the link comes last.
    const phone = `+1555${Math.floor(1000000 + Math.random() * 8999999)}`;
    expect(
      (await admin.auth.admin.updateUserById(s.childId, { phone, phone_confirm: true })).error,
    ).toBeNull();
    // A linked OAuth account: the Admin API cannot make one, so a row like the one GoTrue writes is inserted.
    localSql(
      `INSERT INTO auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
       VALUES ('${s.childId}', 'google', 'realauth-${s.childId}', jsonb_build_object('sub', 'realauth-${s.childId}', 'email', '${s.placeholder}'), now(), now(), now());`,
    );
    const sw = await switchIn(s.placeholder);
    const enrolled = await sw.client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "guardian",
    });
    expect(
      enrolled.error,
      `a switched-in guardian can enrol a second factor: ${enrolled.error?.message}`,
    ).toBeNull();
    expect((await sw.client.auth.updateUser({ password: EARLY })).error).toBeNull();
    const staleLink = must(
      await admin.auth.admin.generateLink({ type: "magiclink", email: s.placeholder }),
      "magic link",
    ).properties.hashed_token;
    const token = mod.newHandoverToken();
    await startHandover(s, token);
    return { s, token, hash: mod.hashHandoverToken(token), staleLink, guardianClient: sw.client };
  }

  /**
   * completeHandover's steps 1 and 3, then a guardian who still has a session sets a password of their own. With
   * `throwawayPassword` the update is exactly the app's; without it, only the database is left to undo what the guardian did.
   * Finish has not run.
   */
  async function claimUpdateThenGuardianPlantsLate(p: Planted, throwawayPassword: boolean) {
    const claim = await admin.rpc(
      "claim_managed_handover" as never,
      { _token_hash: p.hash } as never,
    );
    expect((claim.data as { ok?: boolean })?.ok, JSON.stringify(claim)).toBe(true);
    const upd = await admin.auth.admin.updateUserById(p.s.childId, {
      email: p.s.adultEmail,
      email_confirm: true,
      ...(throwawayPassword
        ? { password: globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID() }
        : {}),
      app_metadata: { managed: false, managed_by: null },
    });
    expect(upd.error).toBeNull();
    return p.guardianClient.auth.updateUser({ password: LATE });
  }

  it("the app's own Admin API update (its throwaway password) already ends the guardian's session and replaces the password, before finish runs", async () => {
    const mod = await import("@/lib/managed-handover.server");
    const p = await plant(mod);
    const late = await claimUpdateThenGuardianPlantsLate(p, true);
    seen["after_app_admin_update_before_finish"] = {
      guardian_late_password: late.error?.message ?? "SET",
      guardian_refresh:
        (await p.guardianClient.auth.refreshSession()).error?.message ?? "REFRESHED",
      early_password_signs_in_as_adult: (await signInResult(p.s.adultEmail, EARLY)).ok,
      sessions_left: Number(
        localSql(`SELECT count(*) FROM auth.sessions WHERE user_id = '${p.s.childId}'`),
      ),
    };
    expect(late.error).not.toBeNull();
    expect((await p.guardianClient.auth.refreshSession()).error).not.toBeNull();
    expect((await signInResult(p.s.adultEmail, EARLY)).ok).toBe(false);
    expect((await signInResult(p.s.adultEmail, LATE)).ok).toBe(false);
    // The managed row and link are still there: only finish_managed_handover removes them.
    const { count } = await admin
      .from("managed_accounts")
      .select("child_user_id", { count: "exact", head: true })
      .eq("child_user_id", p.s.childId);
    expect(count).toBe(1);
  });

  it("control, database on its own: before finish, what the guardian planted works, even a password set after the Admin API update", async () => {
    const mod = await import("@/lib/managed-handover.server");
    const p = await plant(mod);
    // While the account is still managed, the magic link made earlier signs in as the account.
    const v = await client().auth.verifyOtp({ token_hash: p.staleLink, type: "magiclink" });
    expect(v.error, `old magic link, before anything changes: ${v.error?.message}`).toBeNull();
    expect((await signInResult(p.s.placeholder, EARLY)).ok, "early password, managed address").toBe(
      true,
    );

    const late = await claimUpdateThenGuardianPlantsLate(p, false);
    expect(
      late.error,
      `the guardian's live session can still set a password: ${late.error?.message}`,
    ).toBeNull();
    // The hole: with the adult's address on the record and finish not yet run, the guardian's password opens the account.
    expect(
      (await signInResult(p.s.adultEmail, LATE)).ok,
      "late password signs in as the adult",
    ).toBe(true);
    expect(
      (await p.guardianClient.auth.refreshSession()).error,
      "switched-in session refreshes before finish",
    ).toBeNull();
  });

  it("database on its own: finish_managed_handover replaces the late password, removes the extra identity, second factor and phone, and ends every session", async () => {
    const mod = await import("@/lib/managed-handover.server");
    const p = await plant(mod);
    const late = await claimUpdateThenGuardianPlantsLate(p, false);
    expect(late.error).toBeNull();
    const count = (table: string) =>
      Number(localSql(`SELECT count(*) FROM auth.${table} WHERE user_id = '${p.s.childId}'`));
    seen["db_step_before_finish"] = {
      one_time_tokens: count("one_time_tokens"),
      mfa_factors: count("mfa_factors"),
      identity_providers: localSql(
        `SELECT string_agg(provider, ',' ORDER BY provider) FROM auth.identities WHERE user_id = '${p.s.childId}'`,
      ),
      sessions: count("sessions"),
      phone_set: localSql(
        `SELECT (phone IS NOT NULL AND phone <> '') FROM auth.users WHERE id = '${p.s.childId}'`,
      ),
    };
    expect(count("mfa_factors")).toBeGreaterThan(0);
    expect(count("sessions")).toBeGreaterThan(0);
    expect(
      localSql(
        `SELECT count(*) FROM auth.identities WHERE user_id = '${p.s.childId}' AND provider <> 'email'`,
      ),
    ).not.toBe("0");
    const fin = await admin.rpc(
      "finish_managed_handover" as never,
      { _token_hash: p.hash } as never,
    );
    expect(fin.error, `finish_managed_handover: ${fin.error?.message}`).toBeNull();
    expect((fin.data as { ok?: boolean }).ok, JSON.stringify(fin.data)).toBe(true);

    expect((await signInResult(p.s.adultEmail, LATE)).ok, "late password").toBe(false);
    expect((await signInResult(p.s.adultEmail, EARLY)).ok, "early password").toBe(false);
    expect(
      (await client().auth.verifyOtp({ token_hash: p.staleLink, type: "magiclink" })).error,
      "magic link",
    ).not.toBeNull();
    expect(
      (await p.guardianClient.auth.refreshSession()).error,
      "switched-in refresh",
    ).not.toBeNull();

    const user = must(await admin.auth.admin.getUserById(p.s.childId), "record").user;
    expect(user.identities?.map((i) => i.provider)).toEqual(["email"]);
    expect(user.phone || null, "phone").toBeNull();
    expect(user.factors ?? [], "second factors").toEqual([]);
    for (const table of ["mfa_factors", "one_time_tokens", "sessions", "refresh_tokens"]) {
      expect(count(table), table).toBe(0);
    }
    expect(
      localSql(`SELECT (encrypted_password <> '') FROM auth.users WHERE id = '${p.s.childId}'`),
      "a stored password still exists (random, nobody knows it); the adult chooses theirs from the recovery link",
    ).toBe("t");
  });
});

/**
 * The failure paths that put the sign-in record back, against the real Admin API: if the database cannot finish, the
 * account must be managed again in every place (the placeholder address, app_metadata.managed, and the guardian able to
 * switch in), and the adult can retry the same link.
 */
describe("a handover that does not finish leaves the account managed, and can be retried", () => {
  let mod: typeof import("@/lib/managed-handover.server");
  beforeAll(async () => {
    mod = await import("@/lib/managed-handover.server");
  });

  it("a failing finish puts the placeholder address and the managed flag back; the guardian can switch in; the same link then completes", async () => {
    const s = await seedManagedAdult();
    const token = mod.newHandoverToken();
    await startHandover(s, token);
    // Make finish_managed_handover fail inside its transaction, for this account only (the stack is throwaway; the trigger is dropped below).
    const fn = `pg_temp_inject_${rand()}`;
    localSql(
      `CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure for the real-auth test'; END $$;
       CREATE TRIGGER ${fn} BEFORE INSERT ON public.notifications FOR EACH ROW WHEN (NEW.user_id = '${s.guardianId}') EXECUTE FUNCTION public.${fn}();`,
    );
    try {
      await expect(mod.completeHandover(token)).rejects.toThrow();
    } finally {
      localSql(`DROP TRIGGER ${fn} ON public.notifications; DROP FUNCTION public.${fn}();`);
    }
    const rec = must(await admin.auth.admin.getUserById(s.childId), "record").user;
    seen["failed_finish_record"] = {
      managed: isManagedUser(rec),
      managed_by_is_guardian:
        (rec.app_metadata as Record<string, unknown>)["managed_by"] === s.guardianId,
      placeholder_address: isManagedEmail(rec.email),
      address_is_new_placeholder: rec.email !== s.placeholder,
      identity_email_is_placeholder: isManagedEmail(
        (
          rec.identities?.find((i) => i.provider === "email")?.identity_data as Record<
            string,
            unknown
          >
        )?.["email"] as string,
      ),
    };
    expect(isManagedUser(rec)).toBe(true);
    expect(isManagedEmail(rec.email)).toBe(true);
    const { count } = await admin
      .from("managed_accounts")
      .select("child_user_id", { count: "exact", head: true })
      .eq("child_user_id", s.childId);
    expect(count).toBe(1);
    // The guardian can switch in again (generateLink for the record's CURRENT address, as startManagedSession does).
    const again = await switchIn(rec.email!);
    expect(
      (jwtClaims(again.session.access_token)["app_metadata"] as Record<string, unknown>)["managed"],
    ).toBe(true);
    // The link was not spent and the claim was released: the adult retries and it completes.
    expect((await mod.lookupHandover(token)).valid).toBe(true);
    const done = await mod.completeHandover(token);
    expect(done.recoveryTokenHash).toBeTruthy();
    const after = must(await admin.auth.admin.getUserById(s.childId), "record").user;
    expect(after.email).toBe(s.adultEmail);
    expect(isManagedUser(after)).toBe(false);
  });

  it("a half-done record (the adult's address set, the database never finished) is repaired when the guardian cancels, and the guardian can switch in", async () => {
    const s = await seedManagedAdult();
    const token = mod.newHandoverToken();
    await startHandover(s, token);
    // What a process that died after step 3 leaves behind.
    const upd = await admin.auth.admin.updateUserById(s.childId, {
      email: s.adultEmail,
      email_confirm: true,
      password: globalThis.crypto.randomUUID(),
      app_metadata: { managed: false, managed_by: null },
    });
    expect(upd.error).toBeNull();
    expect((await admin.auth.admin.getUserById(s.childId)).data.user?.email).toBe(s.adultEmail);
    // The guardian cancels (their own token, as cancelManagedHandover does), then the server reconciles the record.
    const cancelled = await s.guardian.rpc(
      "cancel_managed_handover" as never,
      { _child: s.childId } as never,
    );
    expect(cancelled.error, cancelled.error?.message).toBeNull();
    expect(await mod.reconcileManagedRecord(s.childId)).toBe("repaired");
    const rec = must(await admin.auth.admin.getUserById(s.childId), "record").user;
    expect(isManagedUser(rec)).toBe(true);
    expect(isManagedEmail(rec.email)).toBe(true);
    const sw = await switchIn(rec.email!);
    expect(
      (jwtClaims(sw.session.access_token)["app_metadata"] as Record<string, unknown>)["managed"],
    ).toBe(true);
    // The adult's address is free again, and nothing signs in with it.
    expect((await signInResult(s.adultEmail, "anything-Else-1!")).ok).toBe(false);
    expect(await mod.reconcileManagedRecord(s.childId)).toBe("ok");
  });
});
