import { createServerFn } from "@tanstack/react-start";
import { createHash } from "crypto";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DEFAULT_AGE_POLICY,
  parseAgePolicy,
  parseChildControls,
  parseCohort,
  type AgeCohort,
  type AgePolicyConfig,
  type ChildControls,
  type ConsentMethod,
  type ConsentRecordView,
} from "@/lib/child-policy";

/* ------------------------------------------------------------------ */
/* Token handling — the plain token never touches the database         */
/* ------------------------------------------------------------------ */

function hashToken(token: string): string {
  return createHash("sha256").update(`openrun-consent:${token}`).digest("hex");
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const CONSENT_TOKEN_TTL_HOURS = 72;

/* ------------------------------------------------------------------ */
/* Shared shapes                                                      */
/* ------------------------------------------------------------------ */

export type ChildStatus = {
  cohort: AgeCohort;
  ageReviewRequired: boolean;
  jurisdiction: string;
  consent: ConsentRecordView | null;
  controls: ChildControls | null;
  policy: AgePolicyConfig;
  hasBirthday: boolean;
};

type ConsentRow = {
  status: string;
  method: string;
  parent_email: string | null;
  requested_at: string | null;
  approved_at: string | null;
  revoked_at: string | null;
  reverify_at: string | null;
};

function toConsentView(row: ConsentRow | null): ConsentRecordView | null {
  if (!row) return null;
  return {
    status: row.status as ConsentRecordView["status"],
    method: row.method as ConsentMethod,
    parentEmail: row.parent_email,
    requestedAt: row.requested_at,
    approvedAt: row.approved_at,
    revokedAt: row.revoked_at,
    reverifyAt: row.reverify_at,
  };
}

async function loadPolicy(supabase: { from: (t: string) => any }): Promise<AgePolicyConfig> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "age_policy")
    .maybeSingle();
  return data ? parseAgePolicy((data as { value: unknown }).value) : DEFAULT_AGE_POLICY;
}

/* ------------------------------------------------------------------ */
/* Member-facing status                                               */
/* ------------------------------------------------------------------ */

export const getMyChildStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChildStatus> => {
    const { supabase, userId } = context;
    // The age columns on `profiles` are deliberately NOT readable by the
    // signed-in role (they are age PII), so the cohort has to come from the
    // SECURITY DEFINER `my_child_context` RPC. Reading them through a plain
    // select silently yielded "unknown", which made the consent gate fail
    // open and let an unapproved child browse the app.
    const [{ data: ctx, error: ctxError }, { data: consent }, { data: controls }, policy] =
      await Promise.all([
        supabase.rpc("my_child_context"),
        supabase
          .from("parental_consents")
          .select(
            "status, method, parent_email, requested_at, approved_at, revoked_at, reverify_at",
          )
          .eq("child_user_id", userId)
          .maybeSingle(),
        supabase.from("child_controls").select("*").eq("child_user_id", userId).maybeSingle(),
        loadPolicy(supabase),
      ]);
    if (ctxError) throw new Error("Could not check your account status. Please try again.");

    const row = (Array.isArray(ctx) ? ctx[0] : ctx) as
      | {
          cohort?: string | null;
          age_review_required?: boolean | null;
          jurisdiction?: string | null;
          has_birthday?: boolean | null;
        }
      | null
      | undefined;

    return {
      cohort: parseCohort(row?.cohort),
      ageReviewRequired: row?.age_review_required === true,
      jurisdiction: row?.jurisdiction ?? policy.jurisdiction,
      consent: toConsentView((consent ?? null) as ConsentRow | null),
      controls: controls ? parseChildControls(controls) : null,
      policy,
      hasBirthday: row?.has_birthday === true,
    };
  });

/* ------------------------------------------------------------------ */
/* Child → guardian consent request                                   */
/* ------------------------------------------------------------------ */

const MAX_CONSENT_REQUESTS_PER_DAY = 3;
/** Distinct guardian addresses a child account may ever email. */
const MAX_CONSENT_RECIPIENTS = 2;

export const requestParentalConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      parentEmail: string;
      parentName?: string;
      relationship?: string;
      jurisdiction?: string;
      versions?: { privacy?: string; terms?: string; child_policy?: string };
    }) =>
      z
        .object({
          parentEmail: z.string().trim().email().max(255),
          parentName: z.string().trim().max(120).optional(),
          relationship: z.enum(["parent", "guardian", "other"]).optional(),
          jurisdiction: z.enum(["US_FEDERAL", "GEORGIA", "OTHER_STATE", "DEFAULT"]).optional(),
          versions: z
            .object({
              privacy: z.string().max(64).optional(),
              terms: z.string().max(64).optional(),
              child_policy: z.string().max(64).optional(),
            })
            .optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    let newRecipientHash: string | null = null;
    // Resend limit: each request emails a recipient the caller chose, so cap
    // how many a single account can trigger per day to stop the link being
    // used to spam arbitrary inboxes. Each new request replaces the previous
    // pending link (one pending request per child).
    {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { count, error: cErr } = await supabaseAdmin
        .from("parental_consent_events")
        .select("id", { count: "exact", head: true })
        .eq("child_user_id", context.userId)
        .eq("action", "consent_requested")
        .gte("created_at", since);
      if (cErr) throw new Error("Could not send the request right now. Please try again.");
      if ((count ?? 0) >= MAX_CONSENT_REQUESTS_PER_DAY) {
        throw new Error(
          "You've sent the most guardian requests allowed today. Please try again tomorrow.",
        );
      }
      // Recipient limit: a child account may only ever email at most
      // MAX_CONSENT_RECIPIENTS distinct guardian addresses (stored hashed).
      const recipientHash = hashToken(data.parentEmail.toLowerCase());
      const { data: prior, error: rErr } = await supabaseAdmin
        .from("parental_consent_events")
        .select("detail")
        .eq("child_user_id", context.userId)
        .eq("action", "consent_recipient")
        .limit(50);
      if (rErr) throw new Error("Could not send the request right now. Please try again.");
      const seen = new Set(
        ((prior ?? []) as { detail: { recipient_hash?: string } | null }[])
          .map((r) => r.detail?.recipient_hash)
          .filter(Boolean) as string[],
      );
      if (!seen.has(recipientHash)) {
        if (seen.size >= MAX_CONSENT_RECIPIENTS) {
          throw new Error(
            "Guardian requests can only go to the guardian emails you've already used. Ask BallaCity support to change it.",
          );
        }
        newRecipientHash = recipientHash;
      }
    }
    const token = newToken();
    const expiresAt = new Date(Date.now() + CONSENT_TOKEN_TTL_HOURS * 3600_000).toISOString();
    const { error } = await context.supabase.rpc("request_parental_consent", {
      _parent_email: data.parentEmail,
      _parent_name: data.parentName ?? "",
      _relationship: data.relationship ?? "guardian",
      _token_hash: hashToken(token),
      _token_expires_at: expiresAt,
      _jurisdiction: data.jurisdiction ?? "US_FEDERAL",
      _versions: data.versions ?? {},
    });
    if (error) throw new Error(error.message);
    if (newRecipientHash) {
      // Remember this guardian address (hashed) so the recipient limit holds.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: consent } = await supabaseAdmin
        .from("parental_consents")
        .select("id")
        .eq("child_user_id", context.userId)
        .maybeSingle();
      if (consent?.id) {
        await supabaseAdmin.from("parental_consent_events").insert({
          consent_id: consent.id,
          child_user_id: context.userId,
          actor_id: context.userId,
          action: "consent_recipient",
          detail: { recipient_hash: newRecipientHash },
        } as never);
      }
    }
    const path = `/parent/consent/${token}`;
    // Email the one-time link to the guardian. Failure must not block the
    // request — the minor can still copy/share the link manually.
    let emailed = false;
    try {
      const { data: prof } = await context.supabase
        .from("profiles")
        .select("display_name")
        .eq("id", context.userId)
        .maybeSingle();
      const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
      const res = await sendTemplateEmail("guardian-approval", data.parentEmail, {
        templateData: {
          childName: (prof as { display_name?: string } | null)?.display_name ?? undefined,
          parentName: data.parentName || undefined,
          approvalUrl: `https://ballacity.com${path}`,
          expiresHours: CONSENT_TOKEN_TTL_HOURS,
        },
        idempotencyKey: `guardian-approval-${hashToken(token)}`,
      });
      emailed = Boolean((res as { sent?: boolean }).sent);
    } catch (e) {
      console.error("[guardian-approval] email send failed", e);
    }
    // The plain token is returned exactly once so it can be delivered to the
    // guardian. It is never stored in readable form.
    return { token, expiresAt, path, emailed };
  });

/* ------------------------------------------------------------------ */
/* Guardian verification landing (public, minimal disclosure)          */
/* ------------------------------------------------------------------ */

export type ConsentLookup = {
  valid: boolean;
  reason: string | null;
  status: string | null;
  childDisplayName: string | null;
  parentEmailMasked: string | null;
  requestedAt: string | null;
};

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  if (!domain) return null;
  const head = user.slice(0, 1);
  return `${head}${"*".repeat(Math.max(2, user.length - 1))}@${domain}`;
}

export const lookupConsentRequest = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) =>
    z.object({ token: z.string().trim().min(16).max(128) }).parse(d),
  )
  .handler(async ({ data }): Promise<ConsentLookup> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("parental_consents")
      .select("status, parent_email, requested_at, token_expires_at, child_user_id")
      .eq("verification_token_hash", hashToken(data.token))
      .maybeSingle();
    if (!row) {
      return {
        valid: false,
        reason: "This approval link is no longer valid.",
        status: null,
        childDisplayName: null,
        parentEmailMasked: null,
        requestedAt: null,
      };
    }
    const r = row as {
      status: string;
      parent_email: string | null;
      requested_at: string | null;
      token_expires_at: string | null;
      child_user_id: string;
    };
    const expired = r.token_expires_at
      ? new Date(r.token_expires_at).getTime() < Date.now()
      : false;
    const { data: child } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", r.child_user_id)
      .maybeSingle();
    return {
      valid: !expired && r.status === "pending",
      reason: expired
        ? "This approval link has expired. Ask your child to send a new request."
        : r.status !== "pending"
          ? "This request has already been handled."
          : null,
      status: r.status,
      childDisplayName: (child as { display_name?: string } | null)?.display_name ?? null,
      parentEmailMasked: maskEmail(r.parent_email),
      requestedAt: r.requested_at,
    };
  });

/**
 * Approval requires the guardian to be signed in with their own adult account.
 * That gives us a verified email address plus an account to attach the guardian
 * link and the Parent Center to — and it blocks casual "fake parent" approvals
 * from a forwarded link alone.
 *
 * LEGAL REVIEW REQUIRED — whether this method is a sufficient verifiable
 * parental-consent mechanism for every data use must be confirmed by counsel.
 * A stricter provider can be configured via `method: "third_party_verified"`.
 */
export const approveConsentAsGuardian = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      token: string;
      acknowledgedPolicies: boolean;
      versions?: { privacy?: string; terms?: string; child_policy?: string };
      scope?: Record<string, boolean>;
    }) =>
      z
        .object({
          token: z.string().trim().min(16).max(128),
          acknowledgedPolicies: z.literal(true),
          versions: z
            .object({
              privacy: z.string().max(64).optional(),
              terms: z.string().max(64).optional(),
              child_policy: z.string().max(64).optional(),
            })
            .optional(),
          scope: z.record(z.string(), z.boolean()).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: me } = await supabase
      .from("profiles")
      .select("age_cohort")
      .eq("id", userId)
      .maybeSingle();
    let cohort = parseCohort((me as { age_cohort?: string } | null)?.age_cohort);
    if (cohort !== "adult") {
      // The profile column can lag behind (or never be set) because the real
      // date of birth lives in a private table. Ask the authoritative routine.
      const { data: status } = await supabase.rpc("my_platform_status");
      const row = (Array.isArray(status) ? status[0] : status) as Record<string, unknown> | null;
      cohort = parseCohort(row?.["cohort"]);
    }
    if (cohort !== "adult") {
      throw new Error(
        "Only an adult account can approve a child account. Add your birthday to your profile first.",
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("approve_parental_consent", {
      _token_hash: hashToken(data.token),
      _method: "email_confirmation" satisfies ConsentMethod,
      _parent_user: userId,
      _versions: { ...(data.versions ?? {}), scope: data.scope ?? {} },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Parent Center                                                      */
/* ------------------------------------------------------------------ */

export type GuardianChild = {
  childUserId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  cohort: AgeCohort;
  ageReviewRequired: boolean;
  relationship: string;
  linkedAt: string | null;
  upcomingGames: number;
  nextGame: { title: string | null; at: string } | null;
  teamCount: number;
  consent: ConsentRecordView | null;
  controls: ChildControls;
  /**
   * True when this guardian created the child's profile and the child has no
   * login of their own. Such a child can only be reached — managed, switched
   * into, or deleted — through this guardian.
   */
  managed: boolean;
};

type OverviewRow = {
  child_user_id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  age_cohort: string | null;
  age_review_required: boolean | null;
  consent_status: string | null;
  consent_method: string | null;
  consent_requested_at: string | null;
  consent_approved_at: string | null;
  consent_revoked_at: string | null;
  consent_reverify_at: string | null;
  consent_parent_email: string | null;
  relationship: string | null;
  linked_at: string | null;
  upcoming_games: number | null;
  next_game_title: string | null;
  next_game_at: string | null;
  team_count: number | null;
};

/**
 * Every minor this guardian is authorised for, in one round trip.
 *
 * The age columns on `profiles` are not selectable by the signed-in role, so
 * the cohort has to come from the guardian-scoped SECURITY DEFINER
 * `guardian_children_overview` RPC — reading them through a plain select
 * silently produced "unknown" for every child. The RPC also folds in the
 * consent record plus upcoming-game and team tallies so the Family Dashboard
 * never fans out one query per child.
 */
export const listMyChildren = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GuardianChild[]> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase.rpc("guardian_children_overview");
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as unknown as OverviewRow[];
    if (list.length === 0) return [];

    const ids = list.map((r) => r.child_user_id);
    const [{ data: controls }, { data: managedRows }] = await Promise.all([
      supabase.from("child_controls").select("*").in("child_user_id", ids),
      // RLS returns only rows this guardian manages.
      supabase
        .from("managed_accounts")
        .select("child_user_id")
        .eq("managed_by", context.userId)
        .in("child_user_id", ids),
    ]);
    const managed = new Set(
      ((managedRows ?? []) as { child_user_id: string }[]).map((m) => m.child_user_id),
    );

    return list.map((r) => {
      const ct = (controls ?? []).find(
        (x) => (x as { child_user_id: string }).child_user_id === r.child_user_id,
      );
      return {
        childUserId: r.child_user_id,
        displayName: r.display_name ?? "Child account",
        username: r.username ?? null,
        avatarUrl: r.avatar_url ?? null,
        cohort: parseCohort(r.age_cohort ?? undefined),
        ageReviewRequired: r.age_review_required === true,
        relationship: r.relationship ?? "parent",
        linkedAt: r.linked_at,
        upcomingGames: r.upcoming_games ?? 0,
        nextGame: r.next_game_at ? { title: r.next_game_title, at: r.next_game_at } : null,
        teamCount: r.team_count ?? 0,
        consent: r.consent_status
          ? toConsentView({
              status: r.consent_status,
              method: r.consent_method ?? "email",
              parent_email: r.consent_parent_email,
              requested_at: r.consent_requested_at,
              approved_at: r.consent_approved_at,
              revoked_at: r.consent_revoked_at,
              reverify_at: r.consent_reverify_at,
            })
          : null,
        controls: parseChildControls(ct ?? null),
        managed: managed.has(r.child_user_id),
      };
    });
  });

/** Guardian ends their own link to a minor. Consent is withdrawn with it. */
export const revokeGuardianLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childUserId: string; reason?: string }) =>
    z
      .object({ childUserId: z.string().uuid(), reason: z.string().trim().max(500).optional() })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("revoke_guardian_link", {
      _child_user_id: data.childUserId,
      _reason: data.reason ?? undefined,
    });
    if (error) {
      throw new Error(
        error.message.includes("NOT_FOUND")
          ? "That family link is no longer active."
          : "Could not end that family link.",
      );
    }
    return { ok: true };
  });

export type FamilyActivityEntry = {
  id: string;
  action: string;
  context: Record<string, string | number | boolean | null>;
  createdAt: string;
  actorIsMe: boolean;
};

/** Immutable family activity trail for one linked minor. */
export const listFamilyActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childUserId: string }) =>
    z.object({ childUserId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }): Promise<FamilyActivityEntry[]> => {
    const { data: rows, error } = await context.supabase
      .from("family_audit_log")
      .select("id, action, context, created_at, actor_user_id")
      .eq("child_user_id", data.childUserId)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) throw new Error("Could not load the family activity log.");
    return (rows ?? []).map((r) => {
      const row = r as {
        id: string;
        action: string;
        context: Record<string, string | number | boolean | null> | null;
        created_at: string;
        actor_user_id: string | null;
      };
      return {
        id: row.id,
        action: row.action,
        context: row.context ?? {},
        createdAt: row.created_at,
        actorIsMe: row.actor_user_id === context.userId,
      };
    });
  });

export const updateChildControls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childUserId: string; controls: Partial<Record<string, unknown>> }) =>
    z
      .object({
        childUserId: z.string().uuid(),
        controls: z.object({
          messaging: z.enum(["off", "guardian_only", "teammates", "peers"]).optional(),
          media_visibility: z.enum(["private", "guardian", "teammates", "members"]).optional(),
          social_discovery: z.boolean().optional(),
          ai_analysis: z.boolean().optional(),
          location_precision: z.enum(["city", "region"]).optional(),
          game_participation: z.boolean().optional(),
          notifications: z.boolean().optional(),
          notification_curfew_lifted: z.boolean().optional(),
          public_profile: z.boolean().optional(),
        }),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("set_child_controls", {
      _child: data.childUserId,
      _controls: data.controls,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const revokeChildConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childUserId: string; reason?: string }) =>
    z
      .object({ childUserId: z.string().uuid(), reason: z.string().trim().max(500).optional() })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("revoke_parental_consent", {
      _child: data.childUserId,
      _reason: data.reason ?? "Withdrawn by guardian",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type ParentRequestRow = {
  id: string;
  child_user_id: string;
  kind: string;
  status: string;
  details: string | null;
  created_at: string;
  resolution_notes: string | null;
};

export const createParentRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childUserId: string; kind: string; details?: string }) =>
    z
      .object({
        childUserId: z.string().uuid(),
        kind: z.enum(["access", "correction", "deletion", "revoke_consent"]),
        details: z.string().trim().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: id, error } = await context.supabase.rpc("create_parent_request", {
      _child: data.childUserId,
      _kind: data.kind,
      _details: data.details ?? "",
    });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const listMyParentRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ParentRequestRow[]> => {
    const { data, error } = await context.supabase
      .from("parent_requests")
      .select("id, child_user_id, kind, status, details, created_at, resolution_notes")
      .eq("parent_user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as ParentRequestRow[];
  });

/** Counts only — a guardian sees their child's footprint, never other members' data. */
export type ChildFootprint = {
  reels: number;
  hiddenReels: number;
  games: number;
  conversations: number;
  availabilities: number;
};

export const getChildFootprint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childUserId: string }) =>
    z.object({ childUserId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }): Promise<ChildFootprint> => {
    const { data: isGuardian } = await context.supabase.rpc("is_guardian_of", {
      _parent: context.userId,
      _child: data.childUserId,
    });
    if (isGuardian !== true) throw new Error("Not authorized for this child account.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const child = data.childUserId;
    const count = async (table: string, column: string, extra?: (q: any) => any) => {
      let q = (supabaseAdmin as any)
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(column, child);
      if (extra) q = extra(q);
      const { count: c } = await q;
      return c ?? 0;
    };
    const [reels, hiddenReels, games, conversations, availabilities] = await Promise.all([
      count("highlight_reels", "user_id"),
      count("highlight_reels", "user_id", (q) => q.not("hidden_at", "is", null)),
      count("game_participants", "user_id"),
      count("conversation_participants", "user_id"),
      count("player_availabilities", "user_id"),
    ]);
    return { reels, hiddenReels, games, conversations, availabilities };
  });

/* ------------------------------------------------------------------ */
/* Admin / moderator controls                                         */
/* ------------------------------------------------------------------ */

export type ChildSafetyOverview = {
  cohortCounts: Record<string, number>;
  consentCounts: Record<string, number>;
  ageReviews: { userId: string; displayName: string; cohort: AgeCohort }[];
  openRequests: {
    id: string;
    kind: string;
    status: string;
    childUserId: string;
    createdAt: string;
    details: string | null;
  }[];
  policy: AgePolicyConfig;
};

async function assertModerator(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_moderator", { _user_id: userId });
  if (data !== true) throw new Error("Not authorized.");
}

export const childSafetyOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChildSafetyOverview> => {
    await assertModerator(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: profiles }, { data: consents }, { data: reviews }, { data: requests }, policy] =
      await Promise.all([
        supabaseAdmin.from("profiles").select("age_cohort"),
        supabaseAdmin.from("parental_consents").select("status"),
        supabaseAdmin
          .from("profiles")
          .select("id, display_name, age_cohort")
          .eq("age_review_required", true)
          .limit(100),
        supabaseAdmin
          .from("parent_requests")
          .select("id, kind, status, child_user_id, created_at, details")
          .in("status", ["open", "in_progress"])
          .order("created_at", { ascending: false })
          .limit(100),
        loadPolicy(context.supabase),
      ]);

    const tally = (rows: unknown[] | null, key: string) => {
      const out: Record<string, number> = {};
      for (const r of rows ?? []) {
        const v = String((r as Record<string, unknown>)[key] ?? "unknown");
        out[v] = (out[v] ?? 0) + 1;
      }
      return out;
    };

    return {
      cohortCounts: tally(profiles, "age_cohort"),
      consentCounts: tally(consents, "status"),
      ageReviews: (reviews ?? []).map((r) => {
        const row = r as { id: string; display_name: string; age_cohort: string };
        return {
          userId: row.id,
          displayName: row.display_name,
          cohort: parseCohort(row.age_cohort),
        };
      }),
      openRequests: (requests ?? []).map((r) => {
        const row = r as {
          id: string;
          kind: string;
          status: string;
          child_user_id: string;
          created_at: string;
          details: string | null;
        };
        return {
          id: row.id,
          kind: row.kind,
          status: row.status,
          childUserId: row.child_user_id,
          createdAt: row.created_at,
          details: row.details,
        };
      }),
      policy,
    };
  });

export const resolveAgeReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; approve: boolean }) =>
    z.object({ userId: z.string().uuid(), approve: z.boolean() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("clear_age_review", {
      _user: data.userId,
      _approve: data.approve,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resolveParentRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: string; notes?: string }) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["in_progress", "completed", "denied"]),
        notes: z.string().trim().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertModerator(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("parent_requests")
      .update({
        status: data.status,
        handled_by: context.userId,
        handled_at: new Date().toISOString(),
        resolution_notes: data.notes ?? null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Transparency: age-change review history and consent audit trail     */
/* ------------------------------------------------------------------ */

export type AgeChangeEvent = {
  id: string;
  fromCohort: string | null;
  toCohort: string | null;
  outcome: string;
  createdAt: string;
};

/**
 * A member can always see why a date-of-birth change was held for review.
 * RLS scopes the rows to the caller, so no extra guard is needed here.
 */
export const listMyAgeChangeEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AgeChangeEvent[]> => {
    const { data, error } = await context.supabase
      .from("age_change_events")
      .select("id, from_cohort, to_cohort, outcome, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => {
      const row = r as {
        id: string;
        from_cohort: string | null;
        to_cohort: string | null;
        outcome: string;
        created_at: string;
      };
      return {
        id: row.id,
        fromCohort: row.from_cohort,
        toCohort: row.to_cohort,
        outcome: row.outcome,
        createdAt: row.created_at,
      };
    });
  });

export type ConsentTrailEntry = {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  method: string | null;
  createdAt: string;
};

/**
 * Consent audit trail for one linked child. Read through the caller's own
 * client so the guardian RLS policy is the boundary; the explicit
 * `is_guardian_of` check keeps the failure mode obvious rather than empty.
 */
export const getChildConsentTrail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childUserId: string }) =>
    z.object({ childUserId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }): Promise<ConsentTrailEntry[]> => {
    const { data: isGuardian } = await context.supabase.rpc("is_guardian_of", {
      _parent: context.userId,
      _child: data.childUserId,
    });
    if (isGuardian !== true) throw new Error("Not authorized for this child account.");

    const { data: rows, error } = await context.supabase
      .from("parental_consent_events")
      .select("id, action, from_status, to_status, method, created_at")
      .eq("child_user_id", data.childUserId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => {
      const row = r as {
        id: string;
        action: string;
        from_status: string | null;
        to_status: string | null;
        method: string | null;
        created_at: string;
      };
      return {
        id: row.id,
        action: row.action,
        fromStatus: row.from_status,
        toStatus: row.to_status,
        method: row.method,
        createdAt: row.created_at,
      };
    });
  });

/* ------------------------------------------------------------------ */
/* Admin family management: guardian links, consent state, invites     */
/* ------------------------------------------------------------------ */

export type AdminFamilyRow = {
  linkId: string;
  parentUserId: string;
  parentName: string;
  childUserId: string;
  childName: string;
  childCohort: AgeCohort;
  relationship: string;
  linkStatus: string;
  verified: boolean;
  consentStatus: string | null;
  createdAt: string;
};

export type AdminFamilyOverview = {
  families: AdminFamilyRow[];
  inviteCounts: Record<string, number>;
};

export const adminFamilyOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminFamilyOverview> => {
    await assertModerator(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: links }, { data: invites }] = await Promise.all([
      supabaseAdmin
        .from("guardian_links")
        .select("id, parent_user_id, child_user_id, relationship, status, verified_at, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin.from("minor_invites").select("status"),
    ]);

    const rows = links ?? [];
    const ids = Array.from(new Set(rows.flatMap((r) => [r.parent_user_id, r.child_user_id])));
    const [{ data: people }, { data: consents }] = await Promise.all([
      ids.length
        ? supabaseAdmin.from("profiles").select("id, display_name, age_cohort").in("id", ids)
        : Promise.resolve({ data: [] as never[] }),
      rows.length
        ? supabaseAdmin
            .from("parental_consents")
            .select("child_user_id, status")
            .in(
              "child_user_id",
              rows.map((r) => r.child_user_id),
            )
        : Promise.resolve({ data: [] as never[] }),
    ]);

    const nameOf = new Map<string, { name: string; cohort: string }>();
    for (const p of people ?? []) {
      const row = p as { id: string; display_name: string | null; age_cohort: string | null };
      nameOf.set(row.id, {
        name: row.display_name ?? "Member",
        cohort: row.age_cohort ?? "unknown",
      });
    }
    const consentOf = new Map<string, string>();
    for (const c of consents ?? []) {
      const row = c as { child_user_id: string; status: string };
      consentOf.set(row.child_user_id, row.status);
    }

    const inviteCounts: Record<string, number> = {};
    for (const i of invites ?? []) {
      const s = String((i as { status: string }).status ?? "unknown");
      inviteCounts[s] = (inviteCounts[s] ?? 0) + 1;
    }

    return {
      families: rows.map((r) => ({
        linkId: r.id,
        parentUserId: r.parent_user_id,
        parentName: nameOf.get(r.parent_user_id)?.name ?? "Member",
        childUserId: r.child_user_id,
        childName: nameOf.get(r.child_user_id)?.name ?? "Member",
        childCohort: parseCohort(nameOf.get(r.child_user_id)?.cohort ?? "unknown"),
        relationship: r.relationship,
        linkStatus: r.status,
        verified: !!r.verified_at,
        consentStatus: consentOf.get(r.child_user_id) ?? null,
        createdAt: r.created_at,
      })),
      inviteCounts,
    };
  });
