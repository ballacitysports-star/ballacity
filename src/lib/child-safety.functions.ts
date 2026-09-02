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

async function loadPolicy(
  supabase: { from: (t: string) => any },
): Promise<AgePolicyConfig> {
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
    const [{ data: profile }, { data: consent }, { data: controls }, policy, { data: bd }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("age_cohort, age_review_required, jurisdiction")
          .eq("id", userId)
          .maybeSingle(),
        supabase
          .from("parental_consents")
          .select("status, method, parent_email, requested_at, approved_at, revoked_at, reverify_at")
          .eq("child_user_id", userId)
          .maybeSingle(),
        supabase.from("child_controls").select("*").eq("child_user_id", userId).maybeSingle(),
        loadPolicy(supabase),
        supabase.rpc("get_my_birthday"),
      ]);

    const p = (profile ?? {}) as {
      age_cohort?: string;
      age_review_required?: boolean;
      jurisdiction?: string;
    };
    return {
      cohort: parseCohort(p.age_cohort),
      ageReviewRequired: p.age_review_required === true,
      jurisdiction: p.jurisdiction ?? policy.jurisdiction,
      consent: toConsentView((consent ?? null) as ConsentRow | null),
      controls: controls ? parseChildControls(controls) : null,
      policy,
      hasBirthday: typeof bd === "string" && bd.length > 0,
    };
  });

/* ------------------------------------------------------------------ */
/* Child → guardian consent request                                   */
/* ------------------------------------------------------------------ */

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
    const token = newToken();
    const expiresAt = new Date(Date.now() + CONSENT_TOKEN_TTL_HOURS * 3600_000).toISOString();
    const { error } = await context.supabase.rpc("request_parental_consent", {
      _parent_email: data.parentEmail,
      _parent_name: data.parentName ?? null,
      _relationship: data.relationship ?? "guardian",
      _token_hash: hashToken(token),
      _token_expires_at: expiresAt,
      _jurisdiction: data.jurisdiction ?? "US_FEDERAL",
      _versions: data.versions ?? {},
    });
    if (error) throw new Error(error.message);
    // The plain token is returned exactly once so it can be delivered to the
    // guardian. It is never stored in readable form.
    return { token, expiresAt, path: `/parent/consent/${token}` };
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
    const expired = r.token_expires_at ? new Date(r.token_expires_at).getTime() < Date.now() : false;
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
    const cohort = parseCohort((me as { age_cohort?: string } | null)?.age_cohort);
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
  cohort: AgeCohort;
  consent: ConsentRecordView | null;
  controls: ChildControls;
};

export const listMyChildren = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GuardianChild[]> => {
    const { supabase, userId } = context;
    const { data: links, error } = await supabase
      .from("guardian_links")
      .select("child_user_id")
      .eq("parent_user_id", userId)
      .eq("status", "active");
    if (error) throw new Error(error.message);
    const ids = (links ?? []).map((l) => (l as { child_user_id: string }).child_user_id);
    if (ids.length === 0) return [];

    const [{ data: profiles }, { data: consents }, { data: controls }] = await Promise.all([
      supabase.from("profiles").select("id, display_name, username, age_cohort").in("id", ids),
      supabase
        .from("parental_consents")
        .select(
          "child_user_id, status, method, parent_email, requested_at, approved_at, revoked_at, reverify_at",
        )
        .in("child_user_id", ids),
      supabase.from("child_controls").select("*").in("child_user_id", ids),
    ]);

    return ids.map((id) => {
      const p = (profiles ?? []).find((x) => (x as { id: string }).id === id) as
        | { display_name?: string; username?: string | null; age_cohort?: string }
        | undefined;
      const c = (consents ?? []).find(
        (x) => (x as { child_user_id: string }).child_user_id === id,
      ) as ConsentRow | undefined;
      const ct = (controls ?? []).find(
        (x) => (x as { child_user_id: string }).child_user_id === id,
      );
      return {
        childUserId: id,
        displayName: p?.display_name ?? "Child account",
        username: p?.username ?? null,
        cohort: parseCohort(p?.age_cohort),
        consent: toConsentView(c ?? null),
        controls: parseChildControls(ct ?? null),
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
          media_visibility: z.enum(["private", "guardian", "teammates"]).optional(),
          social_discovery: z.boolean().optional(),
          ai_analysis: z.boolean().optional(),
          location_precision: z.enum(["city", "region"]).optional(),
          game_participation: z.boolean().optional(),
          notifications: z.boolean().optional(),
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
      _details: data.details ?? null,
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
      let q = supabaseAdmin.from(table).select("*", { count: "exact", head: true }).eq(column, child);
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
        return { userId: row.id, displayName: row.display_name, cohort: parseCohort(row.age_cohort) };
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
