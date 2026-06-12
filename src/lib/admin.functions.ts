import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const adminCheck = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { isAdmin: !!data, userId: context.userId };
  });

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, username, sport, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const { data: usersList } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    const emailMap = new Map(usersList?.users.map((u) => [u.id, u.email]) ?? []);
    const roleMap = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    });
    return {
      users: (profiles ?? []).map((p: any) => ({
        ...p,
        email: emailMap.get(p.id) ?? null,
        roles: roleMap.get(p.id) ?? [],
      })),
    };
  });

export const adminSetRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; role: "admin" | "moderator"; grant: boolean }) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["admin", "moderator"]),
        grant: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.grant) {
      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: data.userId, role: data.role })
        .select();
    } else {
      await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
    }
    return { ok: true };
  });

export const adminListPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: purchases }, { data: subs }] = await Promise.all([
      supabaseAdmin
        .from("purchases")
        .select("id, user_id, product_id, amount_total, currency, status, customer_email, environment, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("subscriptions")
        .select("id, user_id, product_id, status, current_period_end, cancel_at_period_end, environment, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    return { purchases: purchases ?? [], subscriptions: subs ?? [] };
  });

export const adminListReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("reviews")
      .select("id, reviewer_id, reviewee_name, rating, title, body, flagged, created_at")
      .order("flagged", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    return { reviews: data ?? [] };
  });

export const adminDeleteReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("reviews").delete().eq("id", data.id);
    return { ok: true };
  });

export const adminListGames = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("game_payment_settings")
      .select("id, game_id, host_id, entry_fee, payment_deadline, requires_approval, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    return { games: data ?? [] };
  });

export const adminListReels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("highlight_reels")
      .select("id, user_id, title, video_path, status, attempts, error_message, failed_at, environment, created_at, processing_step, step_progress, last_step_at")
      .order("created_at", { ascending: false })
      .limit(200);
    return { reels: data ?? [] };
  });

export const adminRetryReel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; restart?: boolean }) =>
    z.object({ id: z.string().uuid(), restart: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Default: resume from the last successful step (keep processing_step + step_progress).
    // restart=true: full pipeline restart (clear progress).
    const patch: Record<string, any> = {
      status: "processing",
      error_message: null,
      failed_at: null,
      attempts: 0,
      processing_started_at: null,
    };
    if (data.restart) {
      patch.processing_step = "pending";
      patch.step_progress = {};
      patch.last_step_at = null;
    }
    await supabaseAdmin.from("highlight_reels").update(patch).eq("id", data.id);
    return { ok: true, resumed: !data.restart };
  });

export const adminMarkReelFailed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; message: string }) =>
    z.object({ id: z.string().uuid(), message: z.string().min(1).max(2000) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("highlight_reels")
      .update({ status: "failed", error_message: data.message, failed_at: new Date().toISOString() })
      .eq("id", data.id);
    return { ok: true };
  });

export const adminRunReelWorker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const origin = "https://project--9bd576a8-703f-4180-84d6-2cd32f2a851b.lovable.app";
    try {
      const res = await fetch(`${origin}/api/public/reels/process`, { method: "POST" });
      const body: any = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, processed: body?.processed ?? 0 };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Worker call failed" };
    }
  });
