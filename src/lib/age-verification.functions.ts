import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AgeCohort } from "@/lib/child-policy";
import type { PlatformStatus } from "@/lib/age-verification";

/**
 * Server-authoritative age determination.
 *
 * The client NEVER tells the server an age, an age category, or a cohort — it
 * sends a raw date of birth and the database derives everything through
 * public.set_my_birthday / public.my_platform_status. Both are SECURITY
 * DEFINER and scoped to auth.uid(), and direct writes to the private birthday
 * table are revoked, so this RPC is the only way a date of birth is stored.
 */

export type AgeStatus = {
  cohort: AgeCohort;
  ageCategory: string;
  reviewRequired: boolean;
  status: PlatformStatus;
  birthdaySet: boolean;
};

const asCohort = (v: unknown): AgeCohort =>
  v === "child_under_13" || v === "teen_13_15" || v === "teen_16_17" || v === "adult"
    ? v
    : "unknown";

const asStatus = (v: unknown): PlatformStatus =>
  typeof v === "string" ? (v as PlatformStatus) : "age_verification_required";

/** The signed-in member's authoritative age + platform status. */
export const getMyAgeStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AgeStatus> => {
    const { data, error } = await context.supabase.rpc("my_platform_status");
    if (error) throw new Error("Could not check your account status. Please try again.");
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    return {
      cohort: asCohort(row?.["cohort"]),
      ageCategory: typeof row?.["age_category"] === "string" ? (row["age_category"] as string) : "unknown",
      reviewRequired: row?.["review_required"] === true,
      status: asStatus(row?.["status"]),
      birthdaySet: row?.["birthday_set"] === true,
    };
  });

/**
 * Store a date of birth and return the derived cohort/status. Validation
 * (missing, future, impossible, implausible) happens inside the database
 * routine, so a direct API caller gets the same refusals the UI does.
 */
export const submitMyBirthday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { dateOfBirth: string }) => {
    const dob = String(input?.dateOfBirth ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      throw new Error("Enter your date of birth as month, day and year.");
    }
    return { dateOfBirth: dob };
  })
  .handler(async ({ data, context }): Promise<AgeStatus> => {
    const { error } = await context.supabase.rpc("set_my_birthday", { _dob: data.dateOfBirth });
    if (error) throw new Error(friendlyDobError(error.message));

    const { data: status, error: sErr } = await context.supabase.rpc("my_platform_status");
    if (sErr) throw new Error("Saved, but we could not read your account status. Reload the page.");
    const row = (Array.isArray(status) ? status[0] : status) as Record<string, unknown> | null;
    return {
      cohort: asCohort(row?.["cohort"]),
      ageCategory:
        typeof row?.["age_category"] === "string" ? (row["age_category"] as string) : "unknown",
      reviewRequired: row?.["review_required"] === true,
      status: asStatus(row?.["status"]),
      birthdaySet: row?.["birthday_set"] === true,
    };
  });

/** Raw database messages never reach the member. */
function friendlyDobError(message: string): string {
  const m = message ?? "";
  if (m.includes("DOB_REQUIRED")) return "Enter your date of birth to continue.";
  if (m.includes("DOB_IN_FUTURE")) return "That date is in the future. Enter your real birth date.";
  if (m.includes("DOB_INVALID")) return "That date of birth isn't valid. Check the month, day and year.";
  if (m.includes("AUTH_REQUIRED")) return "Sign in again, then add your date of birth.";
  return "We couldn't save your date of birth. Please try again.";
}
