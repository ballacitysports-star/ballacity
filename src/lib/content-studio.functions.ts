/**
 * Content Studio server functions.
 *
 * Every handler re-checks the caller's role on the server: staff
 * (`is_moderator`) for sources and drafts, superadmin for approval, publishing,
 * the destination Page and settings. The status transitions that matter are
 * made by the database routines in 20261022120000_content_studio.sql, which
 * check the role again and refuse anything else, so a hidden button is never the
 * only thing standing in the way.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PublishPayload } from "@/lib/content-studio.server";
import { getAdmin, writeAudit } from "@/lib/superadmin.server";
import {
  CONTENT_STUDIO_SETTINGS_KEY,
  DRAFT_KINDS,
  DRAFT_LIMITS,
  FACT_STATUSES,
  LISTING_KINDS,
  PUBLISH_ERROR_MESSAGES,
  SOURCE_DETAIL_FIELDS,
  SOURCE_STATUSES,
  SOURCE_URL_ERROR_MESSAGES,
  SourceUrlRejected,
  cleanDraftHashtags,
  cleanFacts,
  hasUnverifiedFacts,
  isBallaCityLink,
  normalizeSourceUrl,
  parseContentStudioSettings,
  type ContentStudioSettings,
  type DraftKind,
  type PublishErrorCode,
} from "@/lib/content-studio";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
type Ctx = { supabase: Db; userId: string };

/**
 * The caller's own session. The studio routines read auth.uid() to authorise and
 * to record who acted, so they are called with it, never with the service role.
 * The generated types predate these routines, hence the untyped handle.
 */
function userRpc(ctx: { supabase: unknown }) {
  const client = ctx.supabase as Db;
  return (name: string, args: Record<string, unknown>) => client.rpc(name, args);
}

async function hasRole(ctx: Ctx, fn: "is_moderator" | "is_superadmin") {
  const { data, error } = await userRpc(ctx)(fn, { _user_id: ctx.userId });
  if (error) throw new Error(error.message);
  return data === true;
}

async function assertStaff(ctx: Ctx) {
  if (!(await hasRole(ctx, "is_moderator"))) throw new Error("Forbidden");
}

async function assertSuper(ctx: Ctx) {
  if (!(await hasRole(ctx, "is_superadmin"))) throw new Error("Forbidden");
}

async function settings(admin: Db): Promise<ContentStudioSettings> {
  const { loadContentStudioSettings } = await import("@/lib/content-studio.server");
  return loadContentStudioSettings(admin);
}

function rpcError(error: { message?: string } | null): never {
  throw new Error(error?.message ?? "Request failed");
}

const SOURCE_SELECT =
  "id, url, normalized_url, url_host, platform, source_kind, status, opportunity, title, summary, sport, city, location, event_starts_at, age_group, listing_kind, org_name, details_verified, ai_confidence, linked_subject_type, linked_subject_id, notes, submitted_by, created_at, updated_at";
const DRAFT_SELECT =
  "id, source_id, subject_type, subject_id, channel, kind, message, link_url, hashtags, facts, source_attribution, ai_generated, status, version, approval_id, rejection_reason, created_by, updated_by, created_at, updated_at";

// ---------------------------------------------------------------- overview

export const studioOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context);
    const admin = (await getAdmin()) as Db;
    const { metaConfig } = await import("@/lib/content-studio.server");
    const [isSuper, cfg, sources, drafts, attempts, pages] = await Promise.all([
      hasRole(context, "is_superadmin"),
      settings(admin),
      admin
        .from("content_sources")
        .select(SOURCE_SELECT)
        .order("created_at", { ascending: false })
        .limit(200),
      admin
        .from("content_drafts")
        .select(DRAFT_SELECT)
        .order("updated_at", { ascending: false })
        .limit(200),
      admin
        .from("content_publish_attempts")
        .select(
          "id, draft_id, approval_id, destination_page_id, status, external_post_id, error_code, error_message, started_by, started_at, finished_at",
        )
        .order("started_at", { ascending: false })
        .limit(100),
      // Never the token: social_page_tokens is not read here.
      admin
        .from("social_page_connections")
        .select(
          "id, provider, page_id, page_name, is_destination, status, granted_scopes, last_error, connected_at, last_checked_at",
        )
        .order("connected_at", { ascending: false }),
    ]);
    for (const r of [sources, drafts, attempts, pages])
      if (r.error) throw new Error(r.error.message);
    return {
      canApprove: isSuper,
      settings: cfg,
      metaReady: metaConfig().ready,
      sources: sources.data ?? [],
      drafts: drafts.data ?? [],
      attempts: attempts.data ?? [],
      pages: pages.data ?? [],
    };
  });

// ---------------------------------------------------------------- sources

const detailSchema = z.object({
  title: z.string().trim().max(200).nullish(),
  summary: z.string().trim().max(2000).nullish(),
  sport: z.string().trim().max(60).nullish(),
  city: z.string().trim().max(120).nullish(),
  location: z.string().trim().max(300).nullish(),
  event_starts_at: z.string().datetime({ offset: true }).nullish(),
  age_group: z.string().trim().max(60).nullish(),
  listing_kind: z.enum(LISTING_KINDS).nullish(),
  org_name: z.string().trim().max(200).nullish(),
});

/** Which details a person confirmed. Unknown keys are dropped, not stored. */
const verifiedSchema = z
  .record(z.string(), z.enum(["verified", "unverified"]))
  .transform((m) =>
    Object.fromEntries(
      Object.entries(m).filter(([k]) => (SOURCE_DETAIL_FIELDS as readonly string[]).includes(k)),
    ),
  );

/** Empty strings become NULL so "cleared" and "never set" read the same. */
function cleanDetails(d: z.infer<typeof detailSchema>) {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    out[k] = typeof v === "string" && v.trim() === "" ? null : (v ?? null);
  }
  return out;
}

export const submitStudioSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { url: string; details?: Record<string, unknown> }) =>
    z.object({ url: z.string().max(2100), details: detailSchema.default({}) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertStaff(context);
    const admin = (await getAdmin()) as Db;
    if (!(await settings(admin)).discovery)
      throw new Error("Source submission is turned off in Content Studio settings.");

    let parsed;
    try {
      parsed = normalizeSourceUrl(data.url);
    } catch (e) {
      if (e instanceof SourceUrlRejected) throw new Error(SOURCE_URL_ERROR_MESSAGES[e.code]);
      throw e;
    }

    // Duplicate detection: the same post, however it was copied, is one record.
    const { data: existing } = await admin
      .from("content_sources")
      .select(SOURCE_SELECT)
      .eq("normalized_url", parsed.normalizedUrl)
      .maybeSingle();
    if (existing) return { source: existing, duplicate: true };

    const details = cleanDetails(data.details);
    const { data: row, error } = await admin
      .from("content_sources")
      .insert({
        url: parsed.url,
        normalized_url: parsed.normalizedUrl,
        url_host: parsed.host,
        platform: parsed.platform,
        source_kind: parsed.kind,
        // Nothing is read from the link, so a new source always needs a person to fill it in.
        status: "needs_details",
        ...details,
        submitted_by: context.userId,
      })
      .select(SOURCE_SELECT)
      .single();
    if (error) {
      // Lost a race with an identical submission: return that one.
      if (error.code === "23505") {
        const again = await admin
          .from("content_sources")
          .select(SOURCE_SELECT)
          .eq("normalized_url", parsed.normalizedUrl)
          .single();
        if (again.data) return { source: again.data, duplicate: true };
      }
      throw new Error(error.message);
    }
    await writeAudit(admin, context.userId, {
      action: "content.source_submitted",
      targetType: "content_source",
      targetId: row.id,
      after: { host: parsed.host, platform: parsed.platform, kind: parsed.kind },
    });
    return { source: row, duplicate: false };
  });

export const updateStudioSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id: string;
      details?: Record<string, unknown>;
      verified?: Record<string, string>;
      status?: string;
      opportunity?: string | null;
      notes?: string | null;
    }) =>
      z
        .object({
          id: z.string().uuid(),
          details: detailSchema.optional(),
          verified: verifiedSchema.optional(),
          status: z.enum(SOURCE_STATUSES).optional(),
          opportunity: z.enum(["content_only", "listing_candidate"]).nullish(),
          notes: z.string().trim().max(2000).nullish(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertStaff(context);
    const admin = (await getAdmin()) as Db;
    const patch: Record<string, unknown> = {};
    if (data.details) Object.assign(patch, cleanDetails(data.details));
    if (data.verified) patch.details_verified = data.verified;
    if (data.status) patch.status = data.status;
    if (data.opportunity !== undefined) patch.opportunity = data.opportunity;
    if (data.notes !== undefined) patch.notes = data.notes || null;
    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await admin.from("content_sources").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAudit(admin, context.userId, {
      action: "content.source_updated",
      targetType: "content_source",
      targetId: data.id,
      after: { fields: Object.keys(patch), status: data.status ?? null },
    });
    return { ok: true };
  });

/** Records that a source is about an existing BallaCity listing (made with createUnclaimedListing or found). */
export const linkStudioSourceToListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; subjectType: "team" | "gym"; subjectId: string }) =>
    z
      .object({
        id: z.string().uuid(),
        subjectType: z.enum(["team", "gym"]),
        subjectId: z.string().trim().min(1).max(200),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertStaff(context);
    const admin = (await getAdmin()) as Db;
    if (!(await settings(admin)).listingCreation)
      throw new Error("Listing creation is turned off in Content Studio settings.");

    const table = data.subjectType === "team" ? "teams" : "trainer_orgs";
    const { data: listing } = await admin
      .from(table)
      .select("id")
      .eq("id", data.subjectId)
      .maybeSingle();
    if (!listing) throw new Error("That listing doesn't exist.");

    const { error } = await admin
      .from("content_sources")
      .update({
        linked_subject_type: data.subjectType,
        linked_subject_id: data.subjectId,
        opportunity: "listing_candidate",
        status: "reviewed",
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAudit(admin, context.userId, {
      action: "content.source_linked",
      targetType: "content_source",
      targetId: data.id,
      after: { subjectType: data.subjectType, subjectId: data.subjectId },
    });
    return { ok: true };
  });

// ---------------------------------------------------------------- drafts

const factSchema = z
  .array(z.object({ claim: z.string().max(DRAFT_LIMITS.fact), status: z.enum(FACT_STATUSES) }))
  .max(DRAFT_LIMITS.facts);

function checkLink(link: string | null | undefined) {
  if (link && !isBallaCityLink(link)) {
    throw new Error("Links in a post must be https links to ballacity.com.");
  }
}

async function attributionFor(admin: Db, sourceId: string | null | undefined) {
  if (!sourceId) return null;
  const { data } = await admin
    .from("content_sources")
    .select("url, url_host")
    .eq("id", sourceId)
    .maybeSingle();
  return data ? `Source: ${data.url}` : null;
}

export const createStudioDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      sourceId?: string | null;
      kind: DraftKind;
      message: string;
      linkUrl?: string | null;
      hashtags?: string[];
      facts?: { claim: string; status: string }[];
    }) =>
      z
        .object({
          sourceId: z.string().uuid().nullish(),
          kind: z.enum(DRAFT_KINDS),
          message: z.string().trim().min(1).max(DRAFT_LIMITS.message),
          linkUrl: z.string().trim().max(2048).nullish(),
          hashtags: z.array(z.string().max(60)).max(30).default([]),
          facts: factSchema.default([]),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertStaff(context);
    checkLink(data.linkUrl);
    const admin = (await getAdmin()) as Db;
    const { data: row, error } = await admin
      .from("content_drafts")
      .insert({
        source_id: data.sourceId ?? null,
        kind: data.kind,
        message: data.message,
        link_url: data.linkUrl || null,
        hashtags: cleanDraftHashtags(data.hashtags),
        facts: cleanFacts(data.facts),
        source_attribution: await attributionFor(admin, data.sourceId),
        ai_generated: false,
        created_by: context.userId,
        updated_by: context.userId,
      })
      .select(DRAFT_SELECT)
      .single();
    if (error) throw new Error(error.message);
    await writeAudit(admin, context.userId, {
      action: "content.draft_created",
      targetType: "content_draft",
      targetId: row.id,
      after: { kind: data.kind, sourceId: data.sourceId ?? null, ai: false },
    });
    return { draft: row };
  });

export const generateStudioDraftWithAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { sourceId: string; kind: DraftKind; notes?: string | null; linkUrl?: string | null }) =>
      z
        .object({
          sourceId: z.string().uuid(),
          kind: z.enum(DRAFT_KINDS),
          notes: z.string().trim().max(800).nullish(),
          linkUrl: z.string().trim().max(2048).nullish(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertStaff(context);
    checkLink(data.linkUrl);
    const admin = (await getAdmin()) as Db;
    if (!(await settings(admin)).aiDrafts)
      throw new Error("AI drafting is turned off in Content Studio settings.");

    const { data: source, error: sErr } = await admin
      .from("content_sources")
      .select(SOURCE_SELECT)
      .eq("id", data.sourceId)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!source) throw new Error("Source not found.");
    if (source.status === "dismissed") throw new Error("This source was dismissed.");

    const { generateStudioDraft } = await import("@/lib/content-studio.server");
    const { toAiError } = await import("@/lib/ai/errors");
    let draft;
    try {
      draft = await generateStudioDraft(admin, {
        userId: context.userId,
        kind: data.kind,
        source,
        notes: data.notes,
      });
    } catch (e) {
      // Only the user-safe message leaves the server; provider detail stays here.
      throw new Error(toAiError(e).userMessage);
    }

    const { data: row, error } = await admin
      .from("content_drafts")
      .insert({
        source_id: source.id,
        kind: data.kind,
        message: draft.message,
        link_url: data.linkUrl || null,
        hashtags: draft.hashtags,
        facts: draft.facts,
        source_attribution: `Source: ${source.url}`,
        ai_generated: true,
        created_by: context.userId,
        updated_by: context.userId,
      })
      .select(DRAFT_SELECT)
      .single();
    if (error) throw new Error(error.message);
    await writeAudit(admin, context.userId, {
      action: "content.draft_created",
      targetType: "content_draft",
      targetId: row.id,
      after: { kind: data.kind, sourceId: source.id, ai: true },
    });
    return { draft: row };
  });

export const updateStudioDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id: string;
      message?: string;
      linkUrl?: string | null;
      hashtags?: string[];
      facts?: { claim: string; status: string }[];
      status?: "draft" | "in_review" | "canceled";
    }) =>
      z
        .object({
          id: z.string().uuid(),
          message: z.string().trim().min(1).max(DRAFT_LIMITS.message).optional(),
          linkUrl: z.string().trim().max(2048).nullish(),
          hashtags: z.array(z.string().max(60)).max(30).optional(),
          facts: factSchema.optional(),
          // Approval and publishing states are set by their own routines only.
          status: z.enum(["draft", "in_review", "canceled"]).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertStaff(context);
    if (data.linkUrl !== undefined) checkLink(data.linkUrl);
    const admin = (await getAdmin()) as Db;
    const patch: Record<string, unknown> = { updated_by: context.userId };
    if (data.message !== undefined) patch.message = data.message;
    if (data.linkUrl !== undefined) patch.link_url = data.linkUrl || null;
    if (data.hashtags !== undefined) patch.hashtags = cleanDraftHashtags(data.hashtags);
    if (data.facts !== undefined) patch.facts = cleanFacts(data.facts);
    if (data.status !== undefined) patch.status = data.status;

    // The database guard bumps the version and withdraws any approval when the
    // publishable text changes, and refuses edits once publishing has begun.
    const { data: row, error } = await admin
      .from("content_drafts")
      .update(patch)
      .eq("id", data.id)
      .select(DRAFT_SELECT)
      .single();
    if (error) {
      if (/DRAFT_LOCKED/.test(error.message))
        throw new Error("This draft has been published or is publishing, so it can't be edited.");
      if (/DRAFT_STATUS_SET_BY_WORKFLOW_ONLY/.test(error.message))
        throw new Error("That status change isn't allowed here.");
      throw new Error(error.message);
    }
    await writeAudit(admin, context.userId, {
      action: "content.draft_updated",
      targetType: "content_draft",
      targetId: data.id,
      after: {
        fields: Object.keys(patch).filter((k) => k !== "updated_by"),
        version: row.version,
        status: row.status,
      },
    });
    return { draft: row };
  });

// ---------------------------------------------------------------- approval

const APPROVAL_ERRORS: Record<string, string> = {
  NOT_SUPERADMIN: "Only a superadmin can approve, reject or publish.",
  DRAFT_CHANGED: "The draft changed after you opened it. Review the latest version, then approve.",
  DRAFT_NOT_APPROVABLE: "This draft can't be approved in its current state.",
  NO_DESTINATION_PAGE:
    "Connect the official BallaCity Facebook Page and set it as the destination first.",
  DRAFT_NOT_FOUND: "Draft not found.",
  DRAFT_NOT_REJECTABLE: "This draft can't be rejected in its current state.",
};

function explain(error: { message?: string } | null): never {
  const msg = error?.message ?? "";
  const code = Object.keys(APPROVAL_ERRORS).find((k) => msg.includes(k));
  throw new Error(code ? APPROVAL_ERRORS[code] : msg || "Request failed");
}

export const approveStudioDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; version: number; acknowledgeUnverified?: boolean }) =>
    z
      .object({
        id: z.string().uuid(),
        version: z.number().int().min(1),
        acknowledgeUnverified: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuper(context);
    const admin = (await getAdmin()) as Db;
    const { data: draft } = await admin
      .from("content_drafts")
      .select("facts, version")
      .eq("id", data.id)
      .maybeSingle();
    if (!draft) throw new Error("Draft not found.");
    // A post resting on unconfirmed facts goes out only if the approver says so explicitly.
    if (hasUnverifiedFacts(cleanFacts(draft.facts)) && !data.acknowledgeUnverified) {
      throw new Error(
        "This draft relies on facts nobody has verified. Verify them, or confirm you're approving anyway.",
      );
    }
    // The approver's own session: the routine reads auth.uid() to authorise and to record who approved.
    const { data: approvalId, error } = await userRpc(context)("approve_content_draft", {
      _draft: data.id,
      _expected_version: data.version,
    });
    if (error) explain(error);
    return { approvalId: approvalId as string };
  });

export const rejectStudioDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; reason?: string | null }) =>
    z.object({ id: z.string().uuid(), reason: z.string().trim().max(500).nullish() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuper(context);
    const { error } = await userRpc(context)("reject_content_draft", {
      _draft: data.id,
      _reason: data.reason ?? null,
    });
    if (error) explain(error);
    return { ok: true };
  });

// ---------------------------------------------------------------- publishing

const PUBLISH_ERRORS: Record<string, string> = {
  DRAFT_NOT_APPROVED: "Only an approved draft can be published.",
  APPROVAL_STALE: "The draft changed since it was approved. It needs a new approval.",
  DESTINATION_CHANGED:
    "The destination Page changed since this was approved. Approve it again for the current Page.",
  ALREADY_PUBLISHED: "This approval has already been published.",
  PUBLISH_IN_PROGRESS: "A publish for this draft is already running.",
  IDEMPOTENCY_KEY_REUSED: "That request key belongs to another draft.",
  NOT_SUPERADMIN: "Only a superadmin can publish.",
};

export type PublishResult =
  | { status: "published"; postId: string }
  | { status: "failed"; code: PublishErrorCode; message: string }
  | { status: "pending" };

export const publishStudioDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; idempotencyKey: string }) =>
    z.object({ id: z.string().uuid(), idempotencyKey: z.string().min(8).max(100) }).parse(d),
  )
  .handler(async ({ context, data }): Promise<PublishResult> => {
    await assertSuper(context);
    const admin = (await getAdmin()) as Db;
    const { metaConfig, decryptToken, publishToFacebookPage } =
      await import("@/lib/content-studio.server");
    const cfg = metaConfig();
    if (!(await settings(admin)).publishing)
      throw new Error("Publishing is turned off in Content Studio settings.");
    if (!cfg.ready) throw new Error(PUBLISH_ERROR_MESSAGES.NOT_CONFIGURED);

    const { data: rows, error } = await userRpc(context)("begin_content_publish", {
      _draft: data.id,
      _idempotency_key: data.idempotencyKey,
    });
    if (error) {
      const code = Object.keys(PUBLISH_ERRORS).find((k) => (error.message ?? "").includes(k));
      throw new Error(code ? PUBLISH_ERRORS[code] : error.message);
    }
    const attempt = ((rows ?? []) as unknown[])[0] as
      | {
          attempt_id: string;
          attempt_status: string;
          created: boolean;
          destination_page_id: string;
          payload: PublishPayload;
        }
      | undefined;
    if (!attempt) throw new Error("Publish could not start.");

    // A retried request reports the first one's outcome instead of posting again.
    if (!attempt.created) {
      const { data: prior } = await admin
        .from("content_publish_attempts")
        .select("status, external_post_id, error_code, error_message")
        .eq("id", attempt.attempt_id)
        .single();
      if (prior?.status === "succeeded")
        return { status: "published", postId: prior.external_post_id };
      if (prior?.status === "failed") {
        return {
          status: "failed",
          code: prior.error_code as PublishErrorCode,
          message: prior.error_message ?? "",
        };
      }
      return { status: "pending" };
    }

    const finish = (
      ok: boolean,
      postId: string | null,
      code: string | null,
      message: string | null,
    ) =>
      admin.rpc("finish_content_publish", {
        _attempt: attempt.attempt_id,
        _succeeded: ok,
        _external_post_id: postId,
        _error_code: code,
        _error_message: message,
      });

    const { data: conn } = await admin
      .from("social_page_connections")
      .select("id, page_id, status")
      .eq("provider", "facebook")
      .eq("page_id", attempt.destination_page_id)
      .maybeSingle();
    const { data: tok } = conn
      ? await admin
          .from("social_page_tokens")
          .select("token_ciphertext")
          .eq("connection_id", conn.id)
          .maybeSingle()
      : { data: null };
    if (!conn || conn.status !== "active" || !tok) {
      await finish(false, null, "TOKEN_EXPIRED", "No active token for the destination Page");
      return {
        status: "failed",
        code: "TOKEN_EXPIRED",
        message: PUBLISH_ERROR_MESSAGES.TOKEN_EXPIRED,
      };
    }

    let pageToken: string;
    try {
      pageToken = await decryptToken(tok.token_ciphertext, cfg.tokenKey!);
    } catch {
      await finish(false, null, "TOKEN_EXPIRED", "Stored token could not be decrypted");
      return {
        status: "failed",
        code: "TOKEN_EXPIRED",
        message: PUBLISH_ERROR_MESSAGES.TOKEN_EXPIRED,
      };
    }

    const outcome = await publishToFacebookPage({
      pageId: attempt.destination_page_id,
      pageToken,
      payload: attempt.payload,
    });
    if (outcome.ok) {
      const { error: fErr } = await finish(true, outcome.postId, null, null);
      if (fErr)
        console.error(
          "[content-studio] post published but result not recorded",
          attempt.attempt_id,
          fErr.message,
        );
      return { status: "published", postId: outcome.postId };
    }
    await finish(false, null, outcome.code, outcome.message);
    if (outcome.code === "TOKEN_EXPIRED" || outcome.code === "PERMISSION_MISSING") {
      await admin
        .from("social_page_connections")
        .update({
          status: outcome.code === "TOKEN_EXPIRED" ? "expired" : "error",
          last_error: outcome.message,
          last_checked_at: new Date().toISOString(),
        })
        .eq("id", conn.id);
    }
    return { status: "failed", code: outcome.code, message: PUBLISH_ERROR_MESSAGES[outcome.code] };
  });

// ---------------------------------------------------------------- destination and settings

export const setStudioDestinationPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { connectionId: string }) =>
    z.object({ connectionId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuper(context);
    const { error } = await userRpc(context)("set_content_destination_page", {
      _connection: data.connectionId,
    });
    if (error) rpcError(error);
    return { ok: true };
  });

export const updateStudioSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Partial<ContentStudioSettings>) =>
    z
      .object({
        discovery: z.boolean().optional(),
        aiDrafts: z.boolean().optional(),
        publishing: z.boolean().optional(),
        listingCreation: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuper(context);
    const admin = (await getAdmin()) as Db;
    const before = await settings(admin);
    const after = parseContentStudioSettings({ ...before, ...data });
    const { error } = await admin.from("app_settings").upsert(
      {
        key: CONTENT_STUDIO_SETTINGS_KEY,
        value: after,
        // Staff-only switches: kept out of the publicly readable settings.
        is_public: false,
        updated_by: context.userId,
        description:
          "Content Studio switches (discovery, AI drafts, publishing, listing creation).",
      },
      { onConflict: "key" },
    );
    if (error) throw new Error(error.message);
    await writeAudit(admin, context.userId, {
      action: "content.settings_updated",
      targetType: "app_settings",
      targetId: CONTENT_STUDIO_SETTINGS_KEY,
      before,
      after,
    });
    return { settings: after };
  });

// ---------------------------------------------------------------- connecting the Page

/** Starts Meta's OAuth dialog. Returns the URL to open; the browser comes back to the callback route. */
export const startMetaConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuper(context);
    const { metaConfig, metaRedirectUri, buildMetaDialogUrl, newOAuthState, sha256Hex } =
      await import("@/lib/content-studio.server");
    const cfg = metaConfig();
    if (!cfg.ready) throw new Error(PUBLISH_ERROR_MESSAGES.NOT_CONFIGURED);
    const admin = (await getAdmin()) as Db;
    const state = newOAuthState();
    const { error } = await admin
      .from("social_oauth_states")
      .insert({ state_hash: await sha256Hex(state), user_id: context.userId });
    if (error) throw new Error(error.message);
    return {
      url: buildMetaDialogUrl({ appId: cfg.appId!, redirectUri: metaRedirectUri(), state }),
    };
  });

/** Forgets a Page: its token is deleted and it can no longer be a destination. */
export const disconnectMetaPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { connectionId: string }) =>
    z.object({ connectionId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuper(context);
    const admin = (await getAdmin()) as Db;
    const { data: conn } = await admin
      .from("social_page_connections")
      .select("id, page_id, page_name")
      .eq("id", data.connectionId)
      .maybeSingle();
    if (!conn) throw new Error("Connection not found.");
    const { error: tErr } = await admin
      .from("social_page_tokens")
      .delete()
      .eq("connection_id", conn.id);
    if (tErr) throw new Error(tErr.message);
    const { error } = await admin
      .from("social_page_connections")
      .update({
        status: "revoked",
        is_destination: false,
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", conn.id);
    if (error) throw new Error(error.message);
    await writeAudit(admin, context.userId, {
      action: "content.page_disconnected",
      targetType: "social_page",
      targetId: conn.page_id,
      after: { page_name: conn.page_name },
    });
    return { ok: true };
  });
