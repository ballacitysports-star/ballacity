import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  assertSuperadmin,
  getAdmin,
  writeAudit,
  contentConfig,
  buildOrFilter,
  countRows,
  EDITABLE_PROFILE_FIELDS,
  USER_DETAIL_PROFILE_COLUMNS,
} from "@/lib/superadmin.server";
import {
  MONETIZATION_SETTING_KEY,
  invalidateMonetizationConfigCache,
} from "@/lib/monetization/settings.server";
import { SPORTS } from "@/lib/sample-data";
import { maskSmallCount } from "@/lib/sport-activity";
import { OPEN_REPORT_STATUSES } from "@/lib/report-status";
import { AI_SETTING_KEYS, invalidateAiConfigCache } from "@/lib/ai/settings.server";
import {
  FUNNEL_MINOR_COUNTS_KEY,
  funnelWindowFrom,
  parseFunnelReport,
  type FunnelResult,
} from "@/lib/funnel";
import { isMissingFunctionError } from "@/lib/managed-profile-names";
import { parseScheduledJobs, type ScheduledJobsResult } from "@/lib/scheduled-jobs";

export const superadminCheck = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("is_superadmin", {
      _user_id: context.userId,
    });
    return { isSuperadmin: !!data, userId: context.userId };
  });

export const superadminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const nowIso = new Date().toISOString();

    const [
      users,
      suspended,
      games,
      upcoming,
      teams,
      gyms,
      availability,
      openAvailability,
      reviews,
      flaggedReviews,
      reports,
      openReports,
      messages,
      purchases,
      subscriptions,
      reels,
      joinRequests,
      pendingJoins,
      payments,
      pendingPayments,
    ] = await Promise.all([
      countRows(admin, "profiles"),
      countRows(admin, "profiles", (q) => q.not("suspended_at", "is", null)),
      countRows(admin, "hosted_games"),
      countRows(admin, "hosted_games", (q) => q.gte("date", nowIso)),
      countRows(admin, "teams"),
      countRows(admin, "trainer_orgs"),
      countRows(admin, "player_availabilities"),
      // Open: status "open" and not hidden by moderation. The hourly sweep moves run-out posts to "expired", so a post
      // can count here for up to an hour after it runs out.
      countRows(admin, "player_availabilities", (q) =>
        q.eq("status", "open").is("hidden_at", null),
      ),
      countRows(admin, "reviews"),
      countRows(admin, "reviews", (q) => q.eq("flagged", true)),
      countRows(admin, "user_reports"),
      countRows(admin, "user_reports", (q) => q.in("status", OPEN_REPORT_STATUSES)),
      countRows(admin, "messages"),
      countRows(admin, "purchases"),
      countRows(admin, "subscriptions"),
      countRows(admin, "highlight_reels"),
      countRows(admin, "join_requests"),
      countRows(admin, "join_requests", (q) => q.eq("status", "pending")),
      countRows(admin, "payment_submissions"),
      countRows(admin, "payment_submissions", (q) => q.eq("status", "pending")),
    ]);

    const [{ data: accountTypes }, { data: signins }, { data: denials }, { data: recentAudit }] =
      await Promise.all([
        admin.from("profiles").select("account_type"),
        admin
          .from("auth_signin_events")
          .select("id, created_at, provider, event, error_message")
          .order("created_at", { ascending: false })
          .limit(10),
        admin
          .from("location_denial_events")
          .select("id, created_at, reason, sport")
          .order("created_at", { ascending: false })
          .limit(10),
        admin
          .from("admin_audit_log")
          .select("id, created_at, action, target_type, target_id, reason")
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

    const byType: Record<string, number> = {};
    (accountTypes ?? []).forEach((r: any) => {
      const k = r.account_type ?? "unset";
      byType[k] = (byType[k] ?? 0) + 1;
    });

    return {
      counts: {
        users,
        suspended,
        games,
        upcoming,
        teams,
        gyms,
        availability,
        openAvailability,
        reviews,
        flaggedReviews,
        reports,
        openReports,
        messages,
        purchases,
        subscriptions,
        reels,
        joinRequests,
        pendingJoins,
        payments,
        pendingPayments,
      },
      byType,
      signins: signins ?? [],
      denials: denials ?? [],
      recentAudit: recentAudit ?? [],
    };
  });

export const superadminListUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { search?: string; limit?: number; offset?: number }) =>
    z
      .object({
        search: z.string().max(120).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;

    let q = admin
      .from("profiles")
      .select(
        "id, display_name, username, city, sport, account_type, suspended_at, suspended_reason, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const search = (data.search ?? "").trim();
    if (search) {
      const or = buildOrFilter(["display_name", "username", "city"], search);
      if (/^[0-9a-f-]{36}$/i.test(search)) q = q.eq("id", search);
      else if (or) q = q.or(or);
    }

    const { data: profiles, count } = await q;
    const ids = (profiles ?? []).map((p: any) => p.id);
    const { data: roles } = ids.length
      ? await admin.from("user_roles").select("user_id, role").in("user_id", ids)
      : { data: [] as any[] };

    const roleMap = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      roleMap.set(r.user_id, [...(roleMap.get(r.user_id) ?? []), r.role]);
    });

    const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 200 });
    const emailMap = new Map((usersList?.users ?? []).map((u: any) => [u.id, u.email]));

    return {
      total: count ?? 0,
      users: (profiles ?? []).map((p: any) => ({
        ...p,
        email: emailMap.get(p.id) ?? null,
        roles: roleMap.get(p.id) ?? [],
      })),
    };
  });

export const superadminUserDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const uid = data.userId;

    const [
      { data: profile },
      { data: roles },
      { data: teams },
      { data: orgs },
      { data: games },
      { data: availability },
      { data: reports },
      { data: blocks },
      { data: purchases },
      { data: subs },
      { data: authUser },
    ] = await Promise.all([
      admin
        .from("profiles")
        .select(USER_DETAIL_PROFILE_COLUMNS.join(", "))
        .eq("id", uid)
        .maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", uid),
      admin.from("teams").select("id, name, kind, handle, hidden_at").eq("owner_id", uid),
      admin.from("trainer_orgs").select("id, name, handle, hidden_at").eq("owner_id", uid),
      admin
        .from("hosted_games")
        .select("id, title, sport, date, status, hidden_at")
        .eq("host_id", uid)
        .order("date", { ascending: false })
        .limit(25),
      admin
        .from("player_availabilities")
        .select("id, sports, skill_level, status, hidden_at, created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(25),
      admin
        .from("user_reports")
        .select("id, reporter_id, reported_id, reason, status, created_at")
        .or(`reporter_id.eq.${uid},reported_id.eq.${uid}`)
        .order("created_at", { ascending: false })
        .limit(25),
      admin
        .from("user_blocks")
        .select("id, blocker_id, blocked_id, created_at")
        .or(`blocker_id.eq.${uid},blocked_id.eq.${uid}`)
        .limit(25),
      admin
        .from("purchases")
        .select("id, product_id, amount_total, currency, status, created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(25),
      admin
        .from("subscriptions")
        .select("id, product_id, status, current_period_end, cancel_at_period_end")
        .eq("user_id", uid),
      admin.auth.admin.getUserById(uid),
    ]);

    return {
      profile: profile ?? null,
      email: authUser?.user?.email ?? null,
      lastSignInAt: authUser?.user?.last_sign_in_at ?? null,
      emailConfirmedAt: authUser?.user?.email_confirmed_at ?? null,
      roles: (roles ?? []).map((r: any) => r.role),
      teams: teams ?? [],
      orgs: orgs ?? [],
      games: games ?? [],
      availability: availability ?? [],
      reports: reports ?? [],
      blocks: blocks ?? [],
      purchases: purchases ?? [],
      subscriptions: subs ?? [],
    };
  });

export const superadminSetRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      userId: string;
      role: "admin" | "moderator" | "superadmin";
      grant: boolean;
      reason?: string;
    }) =>
      z
        .object({
          userId: z.string().uuid(),
          role: z.enum(["admin", "moderator", "superadmin"]),
          grant: z.boolean(),
          reason: z.string().max(500).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    if (data.role === "superadmin" && !data.grant && data.userId === context.userId) {
      throw new Error("You cannot remove your own superadmin role.");
    }
    const admin = await getAdmin();
    if (data.grant) {
      await admin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
    } else {
      await admin.from("user_roles").delete().eq("user_id", data.userId).eq("role", data.role);
    }
    await writeAudit(admin, context.userId, {
      action: data.grant ? "role.grant" : "role.revoke",
      targetType: "user",
      targetId: data.userId,
      reason: data.reason ?? null,
      after: { role: data.role },
    });
    return { ok: true };
  });

export const superadminSuspendUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; suspend: boolean; reason?: string }) =>
    z
      .object({
        userId: z.string().uuid(),
        suspend: z.boolean(),
        reason: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    if (data.suspend && data.userId === context.userId) {
      throw new Error("You cannot suspend your own account.");
    }
    const admin = await getAdmin();
    const { data: before } = await admin
      .from("profiles")
      .select("suspended_at, suspended_reason")
      .eq("id", data.userId)
      .maybeSingle();

    const patch = data.suspend
      ? { suspended_at: new Date().toISOString(), suspended_reason: data.reason ?? null }
      : { suspended_at: null, suspended_reason: null };

    const { error } = await admin
      .from("profiles")
      .update(patch as any)
      .eq("id", data.userId);
    if (error) throw new Error(error.message);

    if (data.suspend) {
      try {
        await admin.rpc("admin_revoke_user_sessions", { _user_id: data.userId });
      } catch {
        /* best effort */
      }
    }

    await writeAudit(admin, context.userId, {
      action: data.suspend ? "user.suspend" : "user.unsuspend",
      targetType: "user",
      targetId: data.userId,
      reason: data.reason ?? null,
      before,
      after: patch,
    });
    return { ok: true };
  });

export const superadminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; reason?: string }) =>
    z.object({ userId: z.string().uuid(), reason: z.string().max(500).optional() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    if (data.userId === context.userId) {
      throw new Error("You cannot delete your own account here.");
    }
    const admin = await getAdmin();
    const { data: before } = await admin
      .from("profiles")
      .select("display_name, username, account_type")
      .eq("id", data.userId)
      .maybeSingle();
    const { purgeUserAccount } = await import("@/lib/account-purge.server");
    await purgeUserAccount(data.userId);
    await writeAudit(admin, context.userId, {
      action: "user.delete",
      targetType: "user",
      targetId: data.userId,
      reason: data.reason ?? null,
      before,
    });
    return { ok: true };
  });

export const superadminUpdateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; patch: Record<string, unknown>; reason?: string }) =>
    z
      .object({
        userId: z.string().uuid(),
        patch: z.record(z.string(), z.any()),
        reason: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const patch: Record<string, unknown> = {};
    for (const key of EDITABLE_PROFILE_FIELDS) {
      if (key in data.patch) patch[key] = (data.patch as any)[key];
    }
    if (Object.keys(patch).length === 0) throw new Error("Nothing to update.");

    const { data: before } = await admin
      .from("profiles")
      .select(EDITABLE_PROFILE_FIELDS.join(", "))
      .eq("id", data.userId)
      .maybeSingle();

    const { error } = await admin
      .from("profiles")
      .update(patch as any)
      .eq("id", data.userId);
    if (error) throw new Error(error.message);

    await writeAudit(admin, context.userId, {
      action: "user.profile_update",
      targetType: "user",
      targetId: data.userId,
      reason: data.reason ?? null,
      before,
      after: patch,
    });
    return { ok: true };
  });

export const superadminForceSignOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { error } = await admin.rpc("admin_revoke_user_sessions", {
      _user_id: data.userId,
    });
    if (error) throw new Error(error.message);
    await writeAudit(admin, context.userId, {
      action: "user.force_signout",
      targetType: "user",
      targetId: data.userId,
    });
    return { ok: true };
  });

export const superadminListContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      kind: string;
      search?: string;
      limit?: number;
      offset?: number;
      onlyHidden?: boolean;
      onlyVisible?: boolean;
      onlyHeld?: boolean;
    }) =>
      z
        .object({
          kind: z.string().min(1).max(40),
          search: z.string().max(120).optional(),
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
          onlyHidden: z.boolean().optional(),
          onlyVisible: z.boolean().optional(),
          onlyHeld: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const cfg = contentConfig(data.kind);
    const limit = data.limit ?? 25;
    const offset = data.offset ?? 0;

    let q = admin
      .from(cfg.table)
      .select(cfg.select, { count: "exact" })
      .order(cfg.orderBy, { ascending: false })
      .range(offset, offset + limit - 1);

    const search = (data.search ?? "").trim();
    if (search) {
      const or = buildOrFilter(cfg.searchCols, search);
      if (or) q = q.or(or);
    }
    if (cfg.hideCol) {
      if (cfg.hideCol === "flagged") {
        if (data.onlyHidden) q = q.eq("flagged", true);
        if (data.onlyVisible) q = q.eq("flagged", false);
      } else {
        if (data.onlyHidden) q = q.not(cfg.hideCol, "is", null);
        if (data.onlyVisible) q = q.is(cfg.hideCol, null);
      }
    }

    // AI-held or never-screened text (posts and comments).
    if (data.onlyHeld && cfg.textStatusCol) {
      const statusCol: string = cfg.textStatusCol;
      q = (q as any).in(statusCol, ["pending", "held"]);
    }

    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return {
      rows: rows ?? [],
      total: count ?? 0,
      label: cfg.label,
      hideCol: cfg.hideCol,
      textStatusCol: (cfg.textStatusCol ?? null) as string | null,
    };
  });

export const superadminModerate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind: string; id: string; action: string; reason?: string }) =>
    z
      .object({
        kind: z.string().min(1).max(40),
        id: z.string().min(1).max(200),
        action: z.enum([
          "hide",
          "unhide",
          "close_joins",
          "open_joins",
          "cancel_game",
          "restore_game",
          "close_availability",
          "open_availability",
          "resolve_report",
          "dismiss_report",
          "reopen_report",
          "unverify",
          "verify",
          "approve_text",
          "hold_text",
        ]),
        reason: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const cfg = contentConfig(data.kind);
    const now = new Date().toISOString();

    let patch: Record<string, unknown> = {};
    switch (data.action) {
      case "hide":
        if (!cfg.hideCol) throw new Error("This item cannot be hidden.");
        patch = cfg.hideCol === "flagged" ? { flagged: true } : { [cfg.hideCol]: now };
        break;
      case "unhide":
        if (!cfg.hideCol) throw new Error("This item cannot be unhidden.");
        patch = cfg.hideCol === "flagged" ? { flagged: false } : { [cfg.hideCol]: null };
        break;
      case "close_joins":
        patch = { joins_closed: true };
        break;
      case "open_joins":
        patch = { joins_closed: false };
        break;
      case "cancel_game":
        patch = { status: "cancelled", joins_closed: true };
        break;
      case "restore_game":
        patch = { status: null, joins_closed: false };
        break;
      case "close_availability":
        patch = { status: "closed" };
        break;
      case "open_availability":
        patch = { status: "open" };
        break;
      case "resolve_report":
        patch = { status: "resolved" };
        break;
      case "dismiss_report":
        patch = { status: "dismissed" };
        break;
      case "reopen_report":
        patch = { status: "open" };
        break;
      case "verify":
        patch = { verified: true };
        break;
      case "unverify":
        patch = { verified: false };
        break;
      case "approve_text":
        if (!cfg.textStatusCol) throw new Error("This item has no text review.");
        patch = { [cfg.textStatusCol]: "approved" };
        break;
      case "hold_text":
        if (!cfg.textStatusCol) throw new Error("This item has no text review.");
        patch = { [cfg.textStatusCol]: "held" };
        break;
    }

    const db = admin as any;
    const { data: before } = await db
      .from(cfg.table)
      .select(cfg.select)
      .eq(cfg.idCol, data.id)
      .maybeSingle();

    const { error } = await db
      .from(cfg.table)
      .update(patch as any)
      .eq(cfg.idCol, data.id);

    if (error) throw new Error(error.message);

    await writeAudit(admin, context.userId, {
      action: `${data.kind}.${data.action}`,
      targetType: data.kind,
      targetId: data.id,
      reason: data.reason ?? null,
      before,
      after: patch,
    });
    return { ok: true };
  });

/**
 * Payment health numbers for the admin Payments tab. Runs as the signed-in
 * user, not the service role, so the database's own superadmin check applies
 * on top of the one here.
 */
export const superadminPaymentHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { days?: number } | undefined) =>
    z.object({ days: z.number().int().min(1).max(730).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const { data: health, error } = await (context.supabase.rpc as any)("payment_health_metrics", {
      _days: data.days ?? 90,
    });
    if (error) throw new Error("Couldn't load payment health.");
    return health as import("@/lib/payment-health").PaymentHealth;
  });

/** The funnel functions (20261127100000) are not in the generated client types yet. */
type UntypedRpc = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

/**
 * WP 5.2: the weekly pilot funnel for the Funnel card. Runs as the signed-in user, so superadmin_funnel's own superadmin
 * check applies on top of the one here. The database masks every count from 1 to 4; parseFunnelReport masks again.
 * `available: false` when the function is not on this database yet (the card can ship before the migration).
 */
export const superadminFunnel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { weeks?: number } | undefined) =>
    z.object({ weeks: z.number().int().min(1).max(26).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<FunnelResult> => {
    await assertSuperadmin(context);
    const args = data.weeks ? { _from: funnelWindowFrom(data.weeks) } : {};
    const { data: raw, error } = await (context.supabase.rpc as unknown as UntypedRpc)(
      "superadmin_funnel",
      args,
    );
    if (error) {
      if (isMissingFunctionError(error)) return { available: false };
      throw new Error(error.message || "Couldn't load the funnel.");
    }
    const report = parseFunnelReport(raw);
    if (!report) throw new Error("Couldn't load the funnel.");
    return { available: true, report };
  });

/**
 * WP 5.2: turn the funnel's under-18 / unknown-age column on or off. Only after counsel's sign-off (pilot checklist
 * B1). Runs as the signed-in superadmin: the database checks the role, requires the reason and writes the audit row.
 */
export const superadminSetFunnelMinorCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { enabled: boolean; reason: string }) =>
    z.object({ enabled: z.boolean(), reason: z.string().max(500) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const { data: out, error } = await (context.supabase.rpc as unknown as UntypedRpc)(
      "superadmin_set_funnel_minor_counts",
      { _enabled: data.enabled, _reason: data.reason },
    );
    if (error) throw new Error(error.message || "Couldn't change the under-18 column.");
    return out as { enabled: boolean };
  });

/**
 * Scheduled jobs health for the Scheduled jobs card (20261201100000): pg_cron jobs, their last runs and flags, and pg_net
 * response counts. Runs as the signed-in user, so superadmin_scheduled_jobs's own superadmin check applies; the function
 * never returns a job's command, user or database, and redacts failed-run messages. A database without the function (or
 * without pg_cron) answers "not available" instead of failing.
 */
export const superadminScheduledJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { runs?: number } | undefined) =>
    z.object({ runs: z.number().int().min(1).max(20).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<ScheduledJobsResult> => {
    await assertSuperadmin(context);
    const { data: raw, error } = await (context.supabase.rpc as unknown as UntypedRpc)(
      "superadmin_scheduled_jobs",
      data.runs ? { _runs: data.runs } : {},
    );
    if (error) {
      if (isMissingFunctionError(error)) return { available: false, reason: "not_deployed" };
      throw new Error(error.message || "Couldn't load the scheduled jobs.");
    }
    const result = parseScheduledJobs(raw);
    if (!result) throw new Error("Couldn't load the scheduled jobs.");
    return result;
  });

export const superadminListPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number } | undefined) =>
    z.object({ limit: z.number().int().min(1).max(200).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const limit = data.limit ?? 50;
    const [
      { data: purchases },
      { data: subs },
      { data: submissions },
      { data: methods },
      { data: settings },
      { data: events },
    ] = await Promise.all([
      admin
        .from("purchases")
        .select(
          "id, user_id, product_id, amount_total, currency, status, environment, customer_email, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(limit),
      admin
        .from("subscriptions")
        .select(
          "id, user_id, product_id, status, current_period_end, cancel_at_period_end, environment",
        )
        .order("created_at", { ascending: false })
        .limit(limit),
      admin
        .from("payment_submissions")
        .select(
          "id, game_id, player_id, host_id, payment_type, status, paid_amount, reviewer_notes, submitted_at",
        )
        .order("submitted_at", { ascending: false })
        .limit(limit),
      admin
        .from("host_payment_methods")
        .select("id, host_id, payment_type, label, username, is_enabled, created_at")
        .order("created_at", { ascending: false })
        .limit(limit),
      admin
        .from("game_payment_settings")
        .select("id, game_id, host_id, entry_fee, requires_approval, payment_deadline")
        .order("created_at", { ascending: false })
        .limit(limit),
      admin
        .from("payment_verification_events")
        .select("id, submission_id, action, from_status, to_status, notes, created_at")
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);
    return {
      purchases: purchases ?? [],
      subscriptions: subs ?? [],
      submissions: submissions ?? [],
      methods: methods ?? [],
      settings: settings ?? [],
      events: events ?? [],
    };
  });

export const superadminSetSubmissionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { id: string; status: "pending" | "verified" | "rejected"; notes?: string }) =>
      z
        .object({
          id: z.string().uuid(),
          status: z.enum(["pending", "verified", "rejected"]),
          notes: z.string().max(1000).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { data: before } = await admin
      .from("payment_submissions")
      .select("id, status, reviewer_notes")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await admin
      .from("payment_submissions")
      .update({
        status: data.status,
        reviewer_notes: data.notes ?? null,
        reviewed_at: new Date().toISOString(),
      } as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAudit(admin, context.userId, {
      action: "payment.set_status",
      targetType: "payment_submission",
      targetId: data.id,
      reason: data.notes ?? null,
      before,
      after: { status: data.status },
    });
    return { ok: true };
  });

export const superadminTogglePaymentMethod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; enabled: boolean; reason?: string }) =>
    z
      .object({
        id: z.string().uuid(),
        enabled: z.boolean(),
        reason: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { error } = await admin
      .from("host_payment_methods")
      .update({ is_enabled: data.enabled } as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAudit(admin, context.userId, {
      action: data.enabled ? "payment_method.enable" : "payment_method.disable",
      targetType: "host_payment_method",
      targetId: data.id,
      reason: data.reason ?? null,
      after: { is_enabled: data.enabled },
    });
    return { ok: true };
  });

export const superadminListSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { data } = await admin
      .from("app_settings")
      .select("key, value, description, is_public, updated_at")
      .order("key");
    return { settings: data ?? [] };
  });

export const superadminSetSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      key: string;
      value: unknown;
      description?: string;
      isPublic?: boolean;
      reason?: string;
    }) =>
      z
        .object({
          key: z
            .string()
            .min(1)
            .max(80)
            .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and underscores"),
          value: z.any(),
          description: z.string().max(300).optional(),
          isPublic: z.boolean().optional(),
          /** Why this changed. Recorded in the audit log for consequential flips. */
          reason: z.string().max(500).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    // The under-18 funnel switch changes only through superadmin_set_funnel_minor_counts, which records who and why
    // (the database refuses a write that turns it on from anywhere else).
    if (data.key === FUNNEL_MINOR_COUNTS_KEY) {
      throw new Error("FUNNEL_MINOR_COUNTS_LOCKED: change it from the Funnel card.");
    }
    const admin = await getAdmin();
    const { data: before } = await admin
      .from("app_settings")
      .select("key, value, is_public")
      .eq("key", data.key)
      .maybeSingle();
    const row: Record<string, unknown> = {
      key: data.key,
      value: data.value as any,
      updated_by: context.userId,
    };
    if (data.description !== undefined) row["description"] = data.description;
    if (data.isPublic !== undefined) row["is_public"] = data.isPublic;
    const { error } = await admin.from("app_settings").upsert(row as any, { onConflict: "key" });
    if (error) throw new Error(error.message);
    // Drop the server caches so a toggle takes effect on this isolate at once
    // rather than after its TTL.
    if (data.key === MONETIZATION_SETTING_KEY) invalidateMonetizationConfigCache();
    if ((AI_SETTING_KEYS as readonly string[]).includes(data.key)) invalidateAiConfigCache();
    await writeAudit(admin, context.userId, {
      action: settingAuditAction(data.key, data.value),
      targetType: "app_setting",
      targetId: data.key,
      reason: data.reason ?? null,
      before,
      after: { value: data.value },
      metadata: { key: data.key, isPublic: data.isPublic ?? before?.is_public ?? false },
    });
    return { ok: true };
  });

/**
 * Settings split three ways in the audit trail so security- and flag-related
 * changes are easy to filter apart from ordinary config edits.
 */
function settingAuditAction(key: string, value: unknown) {
  if (/(security|auth|verification|rate_limit|moderation)/i.test(key))
    return "security.setting_update" as const;
  if (typeof value === "boolean" || /(enabled|flag|youth|feature)/i.test(key))
    return "feature_flag.update" as const;
  return "setting.update" as const;
}

export const superadminBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      title: string;
      body?: string;
      link?: string;
      audience: "all" | "player" | "team" | "trainer" | "gym";
      reason?: string;
    }) =>
      z
        .object({
          title: z.string().trim().min(3).max(140),
          body: z.string().trim().max(500).optional(),
          link: z.string().trim().max(300).optional(),
          audience: z.enum(["all", "player", "team", "trainer", "gym"]),
          reason: z.string().max(500).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    let q = admin.from("profiles").select("id").is("suspended_at", null);
    if (data.audience !== "all") q = q.eq("account_type", data.audience);
    const { data: targets, error: qErr } = await q;
    if (qErr) throw new Error(qErr.message);

    const rows = (targets ?? []).map((t: any) => ({
      user_id: t.id,
      type: "announcement",
      title: data.title,
      body: data.body ?? null,
      link: data.link ?? null,
    }));

    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await admin.from("notifications").insert(chunk as any);
      if (error) throw new Error(error.message);
    }

    await writeAudit(admin, context.userId, {
      action: "ops.broadcast",
      targetType: "notification",
      targetId: data.audience,
      reason: data.reason ?? null,
      after: { title: data.title, recipients: rows.length },
    });
    return { ok: true, sent: rows.length };
  });

export const superadminListQueues = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const [{ data: joins }, { data: waitlist }, { data: reels }, { data: orgReqs }] =
      await Promise.all([
        admin
          .from("join_requests")
          .select("id, game_id, player_id, host_id, status, created_at")
          .order("created_at", { ascending: false })
          .limit(50),
        admin
          .from("game_position_waitlist")
          .select("id, game_id, position, user_id, status, created_at")
          .order("created_at", { ascending: false })
          .limit(50),
        admin
          .from("highlight_reels")
          .select("id, user_id, title, status, processing_step, attempts, created_at")
          .order("created_at", { ascending: false })
          .limit(50),
        admin
          .from("org_member_requests")
          .select("id, org_id, user_id, status, created_at")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
    return {
      joins: joins ?? [],
      waitlist: waitlist ?? [],
      reels: reels ?? [],
      orgRequests: orgReqs ?? [],
    };
  });

export const superadminAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { search?: string; targetType?: string; limit?: number; offset?: number }) =>
    z
      .object({
        search: z.string().max(120).optional(),
        targetType: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;
    let q = admin
      .from("admin_audit_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (data.targetType) q = q.eq("target_type", data.targetType);
    const search = (data.search ?? "").trim();
    if (search) {
      const or = buildOrFilter(["action", "target_id", "reason"], search);
      if (or) q = q.or(or);
    }
    const { data: rows, count } = await q;
    return { rows: rows ?? [], total: count ?? 0 };
  });

/** Read-only abuse signals for reviews: mutual high-rating pairs and uniform raters. */
export const superadminReviewSignals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperadmin(context);
    // Called as the signed-in superadmin: the SQL functions check is_moderator(auth.uid()).
    const [rings, uniform] = await Promise.all([
      context.supabase.rpc("review_ring_suspects", { _days: 60 }),
      context.supabase.rpc("review_uniform_raters", { _min: 6 }),
    ]);
    if (rings.error) throw new Error(rings.error.message);
    if (uniform.error) throw new Error(uniform.error.message);
    return { rings: rings.data ?? [], uniform: uniform.data ?? [] };
  });

/**
 * Aggregate activity per sport for the Super admin sport panel: games created
 * in the last 30 days, upcoming games, and teams. Counts only, no people and no
 * age breakdown; any count under the privacy threshold is returned masked.
 */
export const superadminSportActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const now = new Date();
    const nowIso = now.toISOString();
    const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const rows = await Promise.all(
      SPORTS.map(async ({ name }) => {
        const [created, upcoming, teams] = await Promise.all([
          countRows(admin, "hosted_games", (q) => q.eq("sport", name).gte("created_at", since)),
          countRows(admin, "hosted_games", (q) => q.eq("sport", name).gte("date", nowIso)),
          countRows(admin, "teams", (q) => q.contains("sports", [name])),
        ]);
        return {
          sport: name,
          gamesCreated30d: maskSmallCount(created),
          upcomingGames: maskSmallCount(upcoming),
          teams: maskSmallCount(teams),
        };
      }),
    );
    return { rows };
  });
