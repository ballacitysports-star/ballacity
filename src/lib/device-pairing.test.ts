import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PAIRING_CODE_LENGTH,
  devicePairingDisplayState,
  formatPairingCode,
  normalizePairingCode,
} from "@/lib/device-pairing";
import { managedChildErrorMessage } from "@/lib/managed-children";

/**
 * Device pairing: a guardian-issued, revocable session for a managed child's
 * own device — never a login. See src/lib/device-pairing.ts for the design,
 * and supabase/migrations/20261001120000_managed_device_pairing.sql for the
 * database side these tests pin (verified live by replaying the full
 * migration chain on Postgres 16, the same method
 * docs/managed-children-verification.md documents for the managed-children
 * migration — not re-run automatically here, so these guard the parts that
 * would be expensive to lose in a later edit without any test noticing).
 */

// ------------------------------------------------------------------
// Pure helpers
// ------------------------------------------------------------------

describe("formatPairingCode / normalizePairingCode", () => {
  it("formats a full code as two groups of five", () => {
    expect(formatPairingCode("ABCDE12345")).toBe("ABCDE-12345");
  });

  it("leaves a code of the wrong length alone, rather than mis-splitting it", () => {
    expect(formatPairingCode("ABC")).toBe("ABC");
    expect(formatPairingCode("")).toBe("");
  });

  it("normalizes whatever a person typed or pasted into the raw code", () => {
    expect(normalizePairingCode("abcde-12345")).toBe("ABCDE12345");
    expect(normalizePairingCode(" ABCDE 12345 ")).toBe("ABCDE12345");
    expect(normalizePairingCode("abcde-12345-extra")).toBe("ABCDE12345"); // truncated
    expect(normalizePairingCode("")).toBe("");
  });

  it("round-trips through format then normalize", () => {
    const code = "7F2K9XQWRT";
    expect(normalizePairingCode(formatPairingCode(code))).toBe(code);
  });
});

describe("devicePairingDisplayState", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const soon = new Date("2026-10-01T12:05:00Z").toISOString();
  const past = new Date("2026-10-01T11:00:00Z").toISOString();

  it("is 'none' for no row at all", () => {
    expect(devicePairingDisplayState(null, now)).toEqual({ kind: "none" });
    expect(devicePairingDisplayState(undefined, now)).toEqual({ kind: "none" });
  });

  it("is 'none' for a revoked row, confirmed or not", () => {
    expect(
      devicePairingDisplayState(
        { status: "revoked", deviceLabel: null, pairedAt: null, expiresAt: soon },
        now,
      ),
    ).toEqual({ kind: "none" });
    expect(
      devicePairingDisplayState(
        { status: "revoked", deviceLabel: "iPad", pairedAt: past, expiresAt: soon },
        now,
      ),
    ).toEqual({ kind: "none" });
  });

  it("is 'pending' for an unconfirmed, unexpired code", () => {
    expect(
      devicePairingDisplayState(
        { status: "linked", deviceLabel: null, pairedAt: null, expiresAt: soon },
        now,
      ),
    ).toEqual({ kind: "pending", expiresAt: soon });
  });

  it("is 'none' for an unconfirmed code past its own expiry — same derivation listMyMinorInvites uses for a stale invite", () => {
    expect(
      devicePairingDisplayState(
        { status: "linked", deviceLabel: null, pairedAt: null, expiresAt: past },
        now,
      ),
    ).toEqual({ kind: "none" });
  });

  it("is 'paired' once confirmed, even past its original expiry (the code's clock, not the session's)", () => {
    expect(
      devicePairingDisplayState(
        { status: "linked", deviceLabel: "Jake's tablet", pairedAt: past, expiresAt: past },
        now,
      ),
    ).toEqual({ kind: "paired", deviceLabel: "Jake's tablet", pairedAt: past });
  });
});

describe("the shared error vocabulary", () => {
  it.each([
    ["PAIRING_INVALID", /isn't valid/],
    ["PAIRING_EXPIRED", /expired/],
    ["PAIRING_USED", /already used/],
    ["PAIRING_REVOKED", /cancelled/],
    ["PAIRING_NOT_FOUND", /no device/i],
    ["PAIRING_UNAVAILABLE", /isn't available/],
  ] as const)("%s maps to a message a parent or child can act on", (code, pattern) => {
    expect(managedChildErrorMessage(code)).toMatch(pattern);
  });

  it("reuses AUTH_REQUIRED / ADULT_REQUIRED / NOT_MANAGED rather than inventing new codes for the same meaning", () => {
    expect(managedChildErrorMessage("ADULT_REQUIRED")).toMatch(/adult/i);
    expect(managedChildErrorMessage("NOT_MANAGED")).toBeTruthy();
  });
});

// ------------------------------------------------------------------
// The migration — same method as managed-children.test.ts: strip comments,
// extract one function's body, assert on its text. Not executed against a
// real Postgres here (that was done once, by hand, via local replay).
// ------------------------------------------------------------------

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_managed_device_pairing.sql"));
const SQL = stripSqlComments(readFileSync(new URL(file!, MIGRATIONS), "utf8")).replace(/\s+/g, " ");

function sqlFn(name: string): string {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$function\\$;`);
  const m = re.exec(SQL);
  expect(m, `${name} should exist in the migration`).not.toBeNull();
  return m![0];
}

describe("managed_device_pairings", () => {
  it("is readable, never writable, through the API — same shape as managed_accounts", () => {
    expect(SQL).toMatch(/ALTER TABLE public\.managed_device_pairings ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(
      /REVOKE ALL ON public\.managed_device_pairings FROM PUBLIC, anon, authenticated/,
    );
    expect(SQL).toMatch(/GRANT SELECT ON public\.managed_device_pairings TO authenticated/);
    expect(SQL).not.toMatch(
      /GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*managed_device_pairings TO authenticated/,
    );
  });

  it("allows only one linked pairing per child, enforced at the database level", () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS managed_device_pairings_one_active_idx\s*ON public\.managed_device_pairings \(child_user_id\) WHERE status = 'linked'/,
    );
  });

  it("the child is left out of who can read a pairing row", () => {
    const policy = /CREATE POLICY "Device pairings visible[\s\S]*?;/.exec(SQL)![0];
    expect(policy).toMatch(/created_by = auth\.uid\(\)/);
    expect(policy).not.toMatch(/child_user_id = auth\.uid\(\)/);
  });
});

describe("create_device_pairing()", () => {
  const fn = sqlFn("create_device_pairing");
  const body = fn.slice(fn.indexOf("BEGIN"));

  it("runs as a definer, closed to anon", () => {
    expect(fn).toMatch(/SECURITY DEFINER SET search_path = public/);
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_device_pairing\([^)]*\) FROM PUBLIC, anon/,
    );
  });

  it("takes the guardian from auth.uid(), never from an argument", () => {
    expect(fn).toMatch(/_guardian uuid := auth\.uid\(\)/);
    expect(fn).not.toMatch(/_guardian uuid,/);
  });

  it("requires the same guardian-validity bar as provision_managed_child: a verified adult, never itself managed", () => {
    expect(body).toMatch(/COALESCE\(_guardian_cohort, 'unknown'\) <> 'adult'/);
    expect(body).toMatch(/_guardian_confirmed IS NULL/);
    expect(body).toMatch(
      /EXISTS \(SELECT 1 FROM public\.managed_accounts m WHERE m\.child_user_id = _guardian\)/,
    );
    expect(body).toMatch(/RAISE EXCEPTION 'ADULT_REQUIRED/);
  });

  it("requires the child to be managed by this exact guardian", () => {
    expect(body).toMatch(
      /WHERE child_user_id = _child_user_id AND managed_by = _guardian[\s\S]{0,40}RAISE EXCEPTION 'NOT_MANAGED/,
    );
  });

  it("supersedes any existing pairing before inserting the new one", () => {
    const supersede = body.search(
      /UPDATE public\.managed_device_pairings\s*SET status = 'revoked'/,
    );
    const insert = body.search(/INSERT INTO public\.managed_device_pairings/);
    expect(supersede).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(supersede);
  });

  it("logs the supersede and the create as distinct audit actions", () => {
    expect(body).toMatch(/'device_pairing\.superseded'/);
    expect(body).toMatch(/'device_pairing\.created'/);
  });
});

describe("lookup_device_pairing()", () => {
  const fn = sqlFn("lookup_device_pairing");

  it("runs as a definer, closed to anon", () => {
    expect(fn).toMatch(/SECURITY DEFINER SET search_path = public/);
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.lookup_device_pairing\([^)]*\) FROM PUBLIC, anon/,
    );
  });

  it("never writes — a flaky retry on the same code must not burn it", () => {
    expect(fn).not.toMatch(/UPDATE public\.managed_device_pairings/);
    expect(fn).not.toMatch(/INSERT INTO/);
  });

  it("reports revoked ahead of used or expired, so a since-revoked row never reads as merely used", () => {
    const revoked = fn.search(/_row\.status = 'revoked'/);
    const used = fn.search(/_row\.paired_at IS NOT NULL/);
    const expired = fn.search(/_row\.expires_at < now\(\)/);
    expect(revoked).toBeGreaterThan(0);
    expect(used).toBeGreaterThan(revoked);
    expect(expired).toBeGreaterThan(used);
  });
});

describe("confirm_device_pairing()", () => {
  const fn = sqlFn("confirm_device_pairing");
  const body = fn.slice(fn.indexOf("BEGIN"));

  it("is scoped to the caller's own session, never a parameter", () => {
    expect(fn).toMatch(/CREATE OR REPLACE FUNCTION public\.confirm_device_pairing\(\s*\)/);
    expect(fn).toMatch(/_child uuid := auth\.uid\(\)/);
  });

  it("is never an error when there is nothing to confirm — bookkeeping, not what grants access", () => {
    expect(body).not.toMatch(/RAISE EXCEPTION '(?!AUTH_REQUIRED)/);
    expect(body).toMatch(/IF _id IS NULL THEN[\s\S]{0,120}RETURN false;/);
  });
});

describe("revoke_device_pairing()", () => {
  const fn = sqlFn("revoke_device_pairing");
  const body = fn.slice(fn.indexOf("BEGIN"));

  it("requires the child to be managed by this exact guardian", () => {
    expect(body).toMatch(
      /WHERE child_user_id = _child_user_id AND managed_by = _guardian[\s\S]{0,40}RAISE EXCEPTION 'NOT_MANAGED/,
    );
  });

  it("refuses to revoke when nothing is linked, under its own namespaced code", () => {
    expect(body).toMatch(/RAISE EXCEPTION 'PAIRING_NOT_FOUND/);
    // Not the bare "NOT_FOUND" managedChildErrorCode would also match on
    // some other domain's differently-worded message, by word boundary alone.
    expect(body).not.toMatch(/RAISE EXCEPTION 'NOT_FOUND:/);
  });
});

// ------------------------------------------------------------------
// The server functions — same ordering-pin method as managed-session.test.ts,
// adapted to this file's `export const X = createServerFn(...)` shape rather
// than a plain `export async function`.
// ------------------------------------------------------------------

const FNS = readFileSync(new URL("./device-pairing.functions.ts", import.meta.url), "utf8");
const MANAGED_FNS = readFileSync(
  new URL("./managed-children.functions.ts", import.meta.url),
  "utf8",
);

function serverFnSrc(src: string, name: string): string {
  const start = src.indexOf(`export const ${name} = createServerFn(`);
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport const ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("createDevicePairing", () => {
  const body = serverFnSrc(FNS, "createDevicePairing");

  it("requires auth and refuses a managed child's own session first", () => {
    expect(body).toMatch(/\.middleware\(\[requireSupabaseAuth\]\)/);
    const refuse = body.indexOf("refuseManagedCaller(ctx)");
    const adult = body.indexOf('managedChildErrorMessage("ADULT_REQUIRED")');
    expect(refuse).toBeGreaterThan(0);
    expect(adult).toBeGreaterThan(refuse);
  });

  it("clears a stale ban before attempting to create the pairing row", () => {
    const clear = body.indexOf('ban_duration: "none"');
    const create = body.indexOf('ctx.supabase.rpc("create_device_pairing"');
    expect(clear).toBeGreaterThan(0);
    expect(create).toBeGreaterThan(clear);
  });

  it("never stores or logs the plain code — only its hash goes to the database", () => {
    expect(body).toMatch(/_code_hash: hashPairingCode\(candidate\)/);
    expect(body).not.toMatch(/console\.(log|error)\([^)]*candidate/);
  });
});

describe("lookupDevicePairing", () => {
  const body = serverFnSrc(FNS, "lookupDevicePairing");

  it("has no middleware — the one server fn in this app meant to be called with no session at all", () => {
    expect(body).not.toMatch(/\.middleware\(/);
  });

  it("revalidates the auth user directly before minting a session for it", () => {
    const getUser = body.indexOf("supabaseAdmin.auth.admin.getUserById(childUserId)");
    const isManaged = body.indexOf("isManagedUser(user)");
    const link = body.indexOf("supabaseAdmin.auth.admin.generateLink(");
    expect(getUser).toBeGreaterThan(0);
    expect(isManaged).toBeGreaterThan(getUser);
    expect(link).toBeGreaterThan(isManaged);
  });

  it("maps every non-linked lookup state to its own namespaced error", () => {
    for (const code of ["PAIRING_EXPIRED", "PAIRING_USED", "PAIRING_REVOKED", "PAIRING_INVALID"]) {
      expect(body).toContain(code);
    }
  });
});

describe("confirmDevicePairing", () => {
  const body = serverFnSrc(FNS, "confirmDevicePairing");

  it("never throws — a redeeming device can fire-and-forget it", () => {
    expect(body).not.toMatch(/throw new Error/);
  });

  it("expects the caller to be the managed child, unlike every other function here", () => {
    expect(body).toMatch(/if \(!isManagedUser\(\{ app_metadata: ctx\.claims\?\.app_metadata/);
    expect(body).not.toMatch(/refuseManagedCaller/);
  });
});

describe("revokeDevicePairing", () => {
  const body = serverFnSrc(FNS, "revokeDevicePairing");

  it("refuses a managed caller, then revokes the row before banning the account", () => {
    const refuse = body.indexOf("refuseManagedCaller(ctx)");
    const rpc = body.indexOf('ctx.supabase.rpc("revoke_device_pairing"');
    const ban = body.indexOf('ban_duration: "876000h"');
    expect(refuse).toBeGreaterThan(0);
    expect(rpc).toBeGreaterThan(refuse);
    expect(ban).toBeGreaterThan(rpc);
  });
});

describe("startManagedSession also clears a stale pairing ban", () => {
  // Added alongside device pairing: revoking a pairing bans the child (see
  // revokeDevicePairing above), and switching into the child's profile is a
  // guardian action just as legitimate as pairing a fresh device, so it must
  // lift a stale ban the same way — otherwise a guardian who revoked a
  // pairing and never re-paired would find the ordinary "Switch to…" button
  // silently broken too.
  const body = serverFnSrc(MANAGED_FNS, "startManagedSession");

  it("clears the ban before minting the act-as link", () => {
    const clear = body.indexOf('ban_duration: "none"');
    const link = body.indexOf("supabaseAdmin.auth.admin.generateLink(");
    expect(clear).toBeGreaterThan(0);
    expect(link).toBeGreaterThan(clear);
  });
});

// ------------------------------------------------------------------
// The redemption route and the one readPublic route it needs.
// ------------------------------------------------------------------

describe("the redemption route", () => {
  const route = readFileSync(new URL("../routes/devices.pair.tsx", import.meta.url), "utf8");
  const root = readFileSync(new URL("../routes/__root.tsx", import.meta.url), "utf8");

  it("is public — a child's device has no session, not even a different one, to sign in with first", () => {
    expect(root).toMatch(/"\/devices\/pair",/);
  });

  it("never auto-submits a code that arrived in the URL — a mis-scan or forward must not silently pair", () => {
    expect(route).not.toMatch(/useEffect[\s\S]{0,200}submit\(\)/);
  });

  it("looks up, redeems, confirms, then lands — in that order", () => {
    const lookup = route.indexOf("await lookup({");
    const otp = route.indexOf("supabase.auth.verifyOtp(");
    const confirm = route.indexOf("await confirm()");
    const land = route.indexOf('window.location.assign("/feed")');
    expect(lookup).toBeGreaterThan(0);
    expect(otp).toBeGreaterThan(lookup);
    expect(confirm).toBeGreaterThan(otp);
    expect(land).toBeGreaterThan(confirm);
  });

  it("never parks a guardian session — there is none on this device to park", () => {
    // switchToManagedChild is named only in a comment contrasting the two
    // flows; a real reuse of it would read as a call, with parens.
    expect(route).not.toMatch(/writeParked|PARKED_GUARDIAN_KEY|switchToManagedChild\(/);
  });
});

describe("the way back, on a banner or in the switcher", () => {
  const banner = readFileSync(
    new URL("../components/ManagedSessionBanner.tsx", import.meta.url),
    "utf8",
  );
  const switcher = readFileSync(
    new URL("../components/ProfileSwitcher.tsx", import.meta.url),
    "utf8",
  );

  it("the banner computes 'paired' from whether a guardian session is actually parked, not independently", () => {
    expect(banner).toMatch(/const parked = readParkedGuardianSession\(\)/);
    expect(banner).toMatch(/const paired = !parked;/);
    // The derived flag, not a fresh read, must be what the click handler and
    // the label branch on — otherwise a mutation of one silently breaks it.
    expect(banner).toMatch(/if \(paired\) void supabase\.auth\.signOut/);
  });

  it.each([
    ["ManagedSessionBanner", banner],
    ["ProfileSwitcher", switcher],
  ])(
    "%s only offers 'back to guardian' when a guardian session is actually parked",
    (_name, src) => {
      expect(src).toMatch(/readParkedGuardianSession\(\)/);
      expect(src).toMatch(/supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
    },
  );
});
