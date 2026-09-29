import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  childDisplayName,
  initialsForDisplayName,
  isManagedAuthEmailPayload,
  isManagedEmail,
  isManagedUser,
  managedByOf,
  managedChildErrorCode,
  managedChildErrorMessage,
  managedEmailFor,
} from "@/lib/managed-children";

/**
 * Managed children: minors a guardian adds without an email or password.
 *
 * The behaviour was verified by replaying the full migration chain on
 * Postgres 16 and calling provision_managed_child() as real users (see
 * docs/managed-children-verification.md). These pin the parts of the SQL that
 * would be expensive to lose in a later edit — who may call it, what it checks
 * first, and the order its writes must happen in — plus the shared helpers.
 */

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_managed_children.sql"));
const SQL = stripSqlComments(readFileSync(new URL(file!, MIGRATIONS), "utf8")).replace(/\s+/g, " ");
const provision =
  /CREATE OR REPLACE FUNCTION public\.provision_managed_child[\s\S]*?\$function\$;/.exec(SQL)![0];
const body = provision.slice(provision.indexOf("BEGIN"));

describe("managed_accounts", () => {
  it("never lets a guardian be deleted while they manage a child", () => {
    // Otherwise an approved minor account would survive with nobody able to
    // reach it — the child has no credentials of their own.
    expect(SQL).toMatch(/managed_by uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE RESTRICT/);
    expect(SQL).toMatch(
      /child_user_id uuid PRIMARY KEY REFERENCES auth\.users\(id\) ON DELETE CASCADE/,
    );
  });

  it("is readable, never writable, through the API", () => {
    expect(SQL).toMatch(/ALTER TABLE public\.managed_accounts ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/REVOKE ALL ON public\.managed_accounts FROM PUBLIC, anon, authenticated/);
    expect(SQL).toMatch(/GRANT SELECT ON public\.managed_accounts TO authenticated/);
    expect(SQL).not.toMatch(
      /GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*managed_accounts TO authenticated/,
    );
  });
});

describe("provision_managed_child()", () => {
  it("runs as a definer with a pinned search path and is closed to anon", () => {
    expect(provision).toMatch(/SECURITY DEFINER SET search_path TO 'public'/);
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.provision_managed_child\([^)]*\) FROM PUBLIC, anon/,
    );
  });

  it("takes the guardian from auth.uid(), never from an argument", () => {
    expect(provision).toMatch(/_parent uuid := auth\.uid\(\)/);
    expect(provision).not.toMatch(/_parent uuid,/);
  });

  it("only provisions a child created for this guardian, recently", () => {
    expect(body).toMatch(/\(_child_meta ->> 'managed_by'\) IS DISTINCT FROM _parent::text/);
    expect(body).toMatch(/_child_created < now\(\) - interval '15 minutes'/);
  });

  it("requires a verified adult guardian with a confirmed email", () => {
    expect(body).toMatch(/COALESCE\(_parent_cohort, 'unknown'\) <> 'adult'/);
    expect(body).toMatch(/_parent_confirmed IS NULL/);
    expect(body).toMatch(/RAISE EXCEPTION 'ADULT_REQUIRED/);
  });

  it("refuses an adult birthday", () => {
    expect(body).toMatch(/_cohort NOT IN \('child_under_13', 'teen_13_15', 'teen_16_17'\)/);
  });

  it("writes in the order the existing triggers depend on", () => {
    // birthday → cohort derived; name after cohort so an unsafe name raises
    // instead of being silently renamed; link before consent so the approval
    // notification reaches the guardian.
    const at = (re: RegExp) => body.search(re);
    const birthday = at(/INSERT INTO public\.profile_birthdays/);
    const name = at(/UPDATE public\.profiles SET display_name/);
    const link = at(/INSERT INTO public\.guardian_links/);
    const consent = at(/INSERT INTO public\.parental_consents/);
    expect(birthday).toBeGreaterThan(0);
    expect(name).toBeGreaterThan(birthday);
    expect(link).toBeGreaterThan(name);
    expect(consent).toBeGreaterThan(link);
  });

  it("writes guardian controls for every minor cohort, not only where consent is required", () => {
    const controls = body.search(/INSERT INTO public\.child_controls/);
    const consentBlockEnd = body.search(/_consent := true; END IF;/);
    expect(controls).toBeGreaterThan(consentBlockEnd);
  });

  it("records the legal acceptance as given by the guardian", () => {
    expect(body).toMatch(
      /INSERT INTO public\.legal_consents \(user_id, document_type, document_version, accepted_by/,
    );
  });
});

describe("unlinking a managed child", () => {
  it("is refused for the managing guardian", () => {
    const fn = /CREATE OR REPLACE FUNCTION public\.revoke_guardian_link[\s\S]*?\$\$;/.exec(SQL)![0];
    expect(fn).toMatch(/managed_by = v_parent[^;]*RAISE EXCEPTION 'MANAGED_CHILD_DELETE_INSTEAD'/);
  });
});

describe("player_profiles is frozen", () => {
  it("revokes writes from signed-in users", () => {
    const freeze = readdirSync(MIGRATIONS).find((f) => f.endsWith("_freeze_player_profiles.sql"));
    const sql = stripSqlComments(readFileSync(new URL(freeze!, MIGRATIONS), "utf8"));
    expect(sql).toMatch(/REVOKE INSERT, UPDATE ON public\.player_profiles FROM authenticated/);
  });
});

describe("helpers", () => {
  it("builds an undeliverable address that says nothing about the child", () => {
    const email = managedEmailFor("0123456789abcdef0123456789abcdef");
    expect(email).toBe("m0123456789abcdef0123456789abcdef@managed.invalid");
    expect(isManagedEmail(email)).toBe(true);
    expect(isManagedEmail("parent@example.com")).toBe(false);
    expect(() => managedEmailFor("short")).toThrow();
  });

  it("keeps only the last initial", () => {
    expect(childDisplayName("Jake", "Smith")).toEqual({ ok: true, displayName: "Jake S." });
    expect(childDisplayName("  Mary  Ann ", "")).toEqual({ ok: true, displayName: "Mary Ann" });
    expect(childDisplayName("José", "Núñez")).toEqual({ ok: true, displayName: "José N." });
    expect(initialsForDisplayName("Jake S.")).toBe("JS");
  });

  it("rejects names that could carry contact details", () => {
    expect(childDisplayName("", "Smith").ok).toBe(false);
    expect(childDisplayName("Jake5551234", "").ok).toBe(false);
    expect(childDisplayName("jake@example.com", "").ok).toBe(false);
    expect(childDisplayName("Jake", "12 Main St").ok).toBe(false);
  });

  it("reads the managed marker only from app_metadata", () => {
    expect(isManagedUser({ app_metadata: { managed: true, managed_by: "p1" } })).toBe(true);
    expect(isManagedUser({ app_metadata: { managed: "true" } })).toBe(false);
    expect(isManagedUser({ app_metadata: {} })).toBe(false);
    expect(isManagedUser(null)).toBe(false);
    expect(managedByOf({ app_metadata: { managed: true, managed_by: "p1" } })).toBe("p1");
  });

  it("recognises auth-email hook payloads addressed to a managed child", () => {
    expect(isManagedAuthEmailPayload({ user: { email: "mabc@managed.invalid" } })).toBe(true);
    expect(isManagedAuthEmailPayload({ user: { email: "parent@example.com" } })).toBe(false);
    expect(isManagedAuthEmailPayload(null)).toBe(false);
    expect(isManagedAuthEmailPayload({})).toBe(false);
  });

  it("maps database errors to parent-facing messages by whole code", () => {
    expect(managedChildErrorCode("P0001: ADULT_REQUIRED: only a verified adult")).toBe(
      "ADULT_REQUIRED",
    );
    expect(managedChildErrorCode("MANAGED_CHILD_DELETE_INSTEAD")).toBe(
      "MANAGED_CHILD_DELETE_INSTEAD",
    );
    expect(managedChildErrorCode("something else")).toBeNull();
    expect(managedChildErrorMessage("duplicate key value")).toBe(
      "Something went wrong. Please try again.",
    );
    expect(managedChildErrorMessage(new Error("NAME_INVALID: x"))).toMatch(/letters only/);
  });
});
