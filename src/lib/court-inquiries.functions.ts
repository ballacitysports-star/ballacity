import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { courtInquirySchema, courtTypeLabel, formatInquiryWhen } from "./court-inquiries";

// Friendly messages for the guardrails enforced by the database trigger.
function inquiryErrorMessage(message: string): string {
  if (message.includes("CHILD_CANNOT_INQUIRE"))
    return "An adult needs to contact the facility for you.";
  if (message.includes("INQUIRY_RATE_LIMIT"))
    return "You've sent a lot of inquiries today. Try again tomorrow.";
  if (message.includes("INQUIRY_PENDING_LIMIT"))
    return "You already have open inquiries with this facility. Wait for a reply first.";
  return message;
}

/**
 * Send a court inquiry to a facility. Inserted as the caller (RLS + the
 * `guard_org_court_inquiry` trigger apply); managers are then notified with
 * the service role, since a requester can't write to other users' notifications
 * through anything we control.
 */
export const submitCourtInquiry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => courtInquirySchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: org, error: orgErr } = await context.supabase
      .from("trainer_orgs")
      .select("id,name,owner_id")
      .eq("id", data.orgId)
      .maybeSingle();
    if (orgErr) throw new Error(orgErr.message);
    if (!org) throw new Error("That facility no longer exists.");

    const { data: row, error } = await context.supabase
      .from("org_court_inquiries")
      .insert({
        org_id: data.orgId,
        requester_id: context.userId,
        sport: data.sport,
        court_type: data.courtType,
        requested_date: data.date,
        start_time: data.startTime,
        duration_min: data.durationMin,
        player_count: data.playerCount,
        notes: data.notes || null,
      })
      .select("id")
      .single();
    if (error) throw new Error(inquiryErrorMessage(error.message));

    // Best effort: the inquiry is saved even if notifying a manager fails.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: members } = await supabaseAdmin
        .from("trainer_org_members")
        .select("user_id")
        .eq("org_id", data.orgId)
        .in("role", ["owner", "admin"]);
      const managers = new Set<string>(
        [org.owner_id, ...(members ?? []).map((m) => m.user_id)].filter(
          (id): id is string => !!id && id !== context.userId,
        ),
      );
      if (managers.size > 0) {
        const when = formatInquiryWhen(data.date, data.startTime, data.durationMin);
        await supabaseAdmin.from("notifications").insert(
          [...managers].map((user_id) => ({
            user_id,
            type: "court_inquiry",
            title: `Court inquiry for ${org.name}`,
            body: `${data.sport} · ${courtTypeLabel(data.courtType)} · ${when} · ${data.playerCount} player${data.playerCount === 1 ? "" : "s"}`,
            link: `/orgs/${data.orgId}#court-inquiries`,
          })),
        );
      }
    } catch (e) {
      console.error("[court-inquiry] manager notification failed", e);
    }

    return { id: row.id as string };
  });

/** Pending + recent inquiries for a facility; owners/admins only (RLS enforces it too). */
export const listOrgCourtInquiries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: adminErr } = await context.supabase.rpc("is_trainer_org_admin", {
      _org: data.orgId,
      _user: context.userId,
    });
    if (adminErr) throw new Error(adminErr.message);
    if (!isAdmin) throw new Error("Only owners or admins can view court inquiries.");

    const { data: rows, error } = await context.supabase
      .from("org_court_inquiries")
      .select(
        "id,requester_id,sport,court_type,requested_date,start_time,duration_min,player_count,notes,status,created_at",
      )
      .eq("org_id", data.orgId)
      .order("status", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    const ids = Array.from(new Set((rows ?? []).map((r) => r.requester_id)));
    const profiles = new Map<string, { display_name: string | null; avatar_url: string | null }>();
    if (ids.length > 0) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id,display_name,avatar_url")
        .in("id", ids);
      for (const p of profs ?? []) profiles.set(p.id, p);
    }
    return (rows ?? []).map((r) => ({ ...r, requester: profiles.get(r.requester_id) ?? null }));
  });

export const resolveCourtInquiry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: "handled" | "declined" }) =>
    z.object({ id: z.string().uuid(), status: z.enum(["handled", "declined"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // RLS limits this to the facility's owners/admins; no row back means no access.
    const { data: row, error } = await context.supabase
      .from("org_court_inquiries")
      .update({
        status: data.status,
        handled_by: context.userId,
        handled_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("status", "pending")
      .select("id,requester_id,org_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Couldn't update that inquiry.");

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: org } = await supabaseAdmin
        .from("trainer_orgs")
        .select("name")
        .eq("id", row.org_id)
        .maybeSingle();
      await supabaseAdmin.from("notifications").insert({
        user_id: row.requester_id,
        type: "court_inquiry_update",
        title: `${org?.name ?? "The facility"} replied to your court inquiry`,
        body:
          data.status === "handled"
            ? "They've handled your request. Check your messages for details."
            : "They can't accommodate that request. Try another time or facility.",
        link: `/orgs/${row.org_id}`,
      });
    } catch (e) {
      console.error("[court-inquiry] requester notification failed", e);
    }
    return { ok: true };
  });
