import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Date of birth is a locked identity attribute.
 *
 * After registration the database refuses every change (`set_my_birthday`
 * raises BIRTHDAY_LOCKED). The only path that can move it is a correction
 * request reviewed by support, which writes an immutable history entry and
 * lets the existing cohort trigger recompute every age-based permission.
 */

export type BirthdayCorrection = {
  id: string;
  requestedBirthday: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewNotes: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type BirthdayLockState = {
  birthday: string | null;
  locked: boolean;
  requests: BirthdayCorrection[];
};

const asStatus = (v: unknown): BirthdayCorrection["status"] =>
  v === "approved" || v === "rejected" ? v : "pending";

const mapRequest = (row: Record<string, unknown>): BirthdayCorrection => ({
  id: String(row["id"]),
  requestedBirthday: String(row["requested_birthday"] ?? ""),
  reason: String(row["reason"] ?? ""),
  status: asStatus(row["status"]),
  reviewNotes: (row["review_notes"] as string | null) ?? null,
  createdAt: String(row["created_at"] ?? ""),
  reviewedAt: (row["reviewed_at"] as string | null) ?? null,
});

/** The signed-in member's stored date of birth plus their correction history. */
export const getMyBirthdayLock = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BirthdayLockState> => {
    const [{ data: bday }, { data: reqs }] = await Promise.all([
      context.supabase.rpc("get_my_birthday"),
      context.supabase.rpc("my_birthday_corrections"),
    ]);
    const birthday = typeof bday === "string" && bday ? bday : null;
    const rows = (Array.isArray(reqs) ? reqs : []) as Record<string, unknown>[];
    return { birthday, locked: birthday != null, requests: rows.map(mapRequest) };
  });

/** Ask support to correct a locked date of birth. */
export const requestBirthdayCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestedBirthday: string; reason: string; evidence?: string }) => {
    const dob = String(input?.requestedBirthday ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      throw new Error("Enter the correct date of birth as month, day and year.");
    }
    const reason = String(input?.reason ?? "").trim();
    if (reason.length < 10) {
      throw new Error("Tell us in a sentence why the date needs correcting.");
    }
    return { requestedBirthday: dob, reason, evidence: String(input?.evidence ?? "").trim() };
  })
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: id, error } = await context.supabase.rpc("request_birthday_correction", {
      _requested: data.requestedBirthday,
      _reason: data.reason,
      _evidence: data.evidence || undefined,
    });
    if (error) throw new Error(friendly(error.message));
    return { id: String(id) };
  });

export type AdminBirthdayCorrection = BirthdayCorrection & {
  userId: string;
  displayName: string | null;
  handle: string | null;
  currentBirthday: string | null;
  evidence: string | null;
};

/** Support queue. The database refuses this to anyone without an admin role. */
export const listBirthdayCorrections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: string } | undefined) => ({
    status: input?.status === "all" ? undefined : (input?.status ?? "pending"),
  }))
  .handler(async ({ data, context }): Promise<AdminBirthdayCorrection[]> => {
    const { data: rows, error } = await context.supabase.rpc("list_birthday_corrections", {
      _status: data.status,
    });
    if (error) throw new Error(friendly(error.message));
    return ((Array.isArray(rows) ? rows : []) as Record<string, unknown>[]).map((row) => ({
      ...mapRequest(row),
      userId: String(row["user_id"]),
      displayName: (row["display_name"] as string | null) ?? null,
      handle: (row["handle"] as string | null) ?? null,
      currentBirthday: (row["current_birthday"] as string | null) ?? null,
      evidence: (row["evidence"] as string | null) ?? null,
    }));
  });

/** Approve or decline a correction. Approval is the only unlock path. */
export const reviewBirthdayCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; approve: boolean; notes?: string }) => {
    const id = String(input?.id ?? "").trim();
    if (!id) throw new Error("Missing correction request.");
    return { id, approve: input?.approve === true, notes: String(input?.notes ?? "").trim() };
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("review_birthday_correction", {
      _id: data.id,
      _approve: data.approve,
      _notes: data.notes || undefined,
    });
    if (error) throw new Error(friendly(error.message));
    return { ok: true };
  });

function friendly(message: string): string {
  const m = message ?? "";
  if (m.includes("BIRTHDAY_LOCKED"))
    return "Your date of birth is locked. Request a correction and support will review it.";
  if (m.includes("DOB_UNCHANGED")) return "That is already the date of birth we have on file.";
  if (m.includes("REQUEST_PENDING")) return "You already have a correction under review.";
  if (m.includes("REASON_REQUIRED")) return "Tell us why the date needs correcting.";
  if (m.includes("DOB_INVALID")) return "That date of birth isn't valid.";
  if (m.includes("ALREADY_REVIEWED")) return "That request was already decided.";
  if (m.includes("FORBIDDEN")) return "You don't have access to birthday corrections.";
  if (m.includes("NOT_FOUND")) return "That correction request no longer exists.";
  return "Something went wrong. Please try again.";
}
