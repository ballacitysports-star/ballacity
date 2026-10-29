/**
 * Superadmin Discovery: server functions for finding teams, gyms and trainers
 * on the public web and reviewing what was found.
 *
 * Everything checks the caller is a superadmin first. The run itself is driven
 * by repeated `superadminDiscoveryStep` calls from the tab; each does a few
 * lookups or page reads and returns the run's state.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSuperadmin, getAdmin, writeAudit } from "@/lib/superadmin.server";
import { DISCOVERY_AREAS, DISCOVERY_TYPES, areaById } from "@/lib/discovery/areas";
import type { DiscoveryDeps } from "@/lib/discovery/engine.server";

const RUN_ID = z.string().uuid();

/**
 * Removes the listing an approved find created, and writes the audit entry.
 * Shared by the single and bulk paths so both record the same thing.
 */
async function removeApproved(
  context: { supabase: unknown; userId: string },
  admin: Awaited<ReturnType<typeof getAdmin>>,
  id: string,
  bulk: boolean,
) {
  const review = await import("@/lib/discovery/review.server");
  const { removeUnclaimedListingRecord } = await import("@/lib/listings-create.server");
  const done = await review.removeApprovedCandidate(
    admin,
    {
      remove: (type, listingId) => removeUnclaimedListingRecord(context.supabase, type, listingId),
    },
    { id },
  );
  await writeAudit(admin, context.userId, {
    action: "listing.delete_unclaimed",
    targetType: done.subjectType === "team" ? "team" : "org",
    targetId: done.listingId,
    before: {
      candidateId: done.candidate.id,
      name: done.candidate.name,
      type: done.candidate.subject_type,
      sourceUrl: done.candidate.source_url,
    },
    metadata: { via: "discovery", bulk, alreadyGone: done.alreadyGone },
  });
  return done;
}

/** Real network, AI and clock; the engine takes these so tests can swap them. */
async function realDeps(admin: unknown, userId: string): Promise<DiscoveryDeps> {
  const [sources, extract] = await Promise.all([
    import("@/lib/discovery/sources.server"),
    import("@/lib/discovery/extract.server"),
  ]);
  return {
    now: () => Date.now(),
    searchEnabled: sources.firecrawlConfigured(),
    searchWeb: sources.searchWeb,
    osmLeads: sources.osmLeads,
    fetchPage: sources.fetchPage,
    extract: (input) => extract.extractPageOrganizations(admin as never, { ...input, userId }),
    isFatalError: extract.isFatalAiMessage,
  };
}

export const superadminDiscoveryOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const [{ latestRun }, sources] = await Promise.all([
      import("@/lib/discovery/engine.server"),
      import("@/lib/discovery/sources.server"),
    ]);
    return {
      areas: DISCOVERY_AREAS.map((a) => ({ id: a.id, label: a.label })),
      searchEnabled: sources.firecrawlConfigured(),
      run: await latestRun(admin),
    };
  });

export const superadminDiscoveryStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { areaId: string; types: string[]; maxPages?: number }) =>
    z
      .object({
        areaId: z.string().min(1).max(40),
        types: z.array(z.enum(DISCOVERY_TYPES)).min(1),
        maxPages: z.number().int().min(1).max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { startRun } = await import("@/lib/discovery/engine.server");
    const deps = await realDeps(admin, context.userId);
    const run = await startRun(admin, deps, { userId: context.userId, ...data });
    await writeAudit(admin, context.userId, {
      action: "discovery.run",
      targetType: "discovery_run",
      targetId: run.id,
      after: { area: areaById(data.areaId)?.label, types: data.types, maxPages: run.maxPages },
    });
    return run;
  });

export const superadminDiscoveryStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { runId: string }) => z.object({ runId: RUN_ID }).parse(d))
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { stepRun } = await import("@/lib/discovery/engine.server");
    const deps = await realDeps(admin, context.userId);
    return stepRun(admin, deps, { runId: data.runId, userId: context.userId });
  });

export const superadminDiscoveryCancel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { runId: string }) => z.object({ runId: RUN_ID }).parse(d))
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { cancelRun, latestRun } = await import("@/lib/discovery/engine.server");
    await cancelRun(admin, data.runId, Date.now());
    return latestRun(admin);
  });

export const superadminDiscoveryList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      status?: "pending" | "approved" | "rejected";
      type?: (typeof DISCOVERY_TYPES)[number];
      search?: string;
      limit?: number;
      offset?: number;
    }) =>
      z
        .object({
          status: z.enum(["pending", "approved", "rejected"]).default("pending"),
          type: z.enum(DISCOVERY_TYPES).optional(),
          search: z.string().max(120).optional(),
          limit: z.number().int().min(1).max(100).default(25),
          offset: z.number().int().min(0).default(0),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { listCandidates } = await import("@/lib/discovery/review.server");
    return listCandidates(admin, data);
  });

const EDITS = z
  .object({
    name: z.string().max(200),
    city: z.string().max(200).nullable(),
    address: z.string().max(300).nullable(),
    website: z.string().max(300).nullable(),
    sports: z.array(z.string().max(40)).max(12),
    category: z.string().max(80).nullable(),
  })
  .partial();

export const superadminDiscoveryReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id: string;
      action: "approve" | "reject" | "remove";
      edits?: z.infer<typeof EDITS>;
      reason?: string;
      confirmDuplicate?: boolean;
    }) =>
      z
        .object({
          id: z.string().uuid(),
          action: z.enum(["approve", "reject", "remove"]),
          edits: EDITS.optional(),
          reason: z.string().max(200).optional(),
          confirmDuplicate: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const review = await import("@/lib/discovery/review.server");
    const nowIso = new Date().toISOString();

    if (data.action === "remove") {
      await removeApproved(context, admin, data.id, false);
      return { ok: true as const };
    }

    if (data.action === "reject") {
      const c = await review.rejectCandidate(
        admin,
        { reviewerId: context.userId, nowIso },
        { id: data.id, reason: data.reason },
      );
      await writeAudit(admin, context.userId, {
        action: "discovery.reject",
        targetType: "listing_candidate",
        targetId: c.id,
        reason: data.reason ?? null,
        before: { name: c.name, type: c.subject_type, sourceUrl: c.source_url },
      });
      return { ok: true as const };
    }

    const { createUnclaimedListingRecord } = await import("@/lib/listings-create.server");
    const done = await review.approveCandidate(
      admin,
      {
        create: (input) => createUnclaimedListingRecord(context.supabase, input),
        reviewerId: context.userId,
        nowIso,
      },
      { id: data.id, edits: data.edits, confirmDuplicate: data.confirmDuplicate },
    );
    await writeAudit(admin, context.userId, {
      action: "discovery.approve",
      targetType: done.subjectType === "team" ? "team" : "org",
      targetId: done.listingId,
      after: {
        candidateId: done.candidate.id,
        name: data.edits?.name ?? done.candidate.name,
        type: done.candidate.subject_type,
        sourceUrl: done.candidate.source_url,
      },
    });
    return { ok: true as const, listingId: done.listingId };
  });

export const superadminDiscoveryBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ids: string[]; action: "approve" | "reject" | "remove" }) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(50),
        action: z.enum(["approve", "reject", "remove"]),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const review = await import("@/lib/discovery/review.server");
    const { createUnclaimedListingRecord } = await import("@/lib/listings-create.server");
    const result = { done: 0, skipped: 0, failed: [] as { name: string; error: string }[] };

    for (const id of data.ids) {
      const nowIso = new Date().toISOString();
      let name = id;
      try {
        const row = await review.getCandidate(admin, id);
        // Approving and rejecting act on finds still waiting; removing acts on
        // approved ones that still have a listing.
        const actable =
          data.action === "remove"
            ? row?.status === "approved" && !!row.created_listing_id
            : row?.status === "pending";
        if (!row || !actable) {
          result.skipped++;
          continue;
        }
        name = row.name;
        if (data.action === "remove") {
          await removeApproved(context, admin, id, true);
        } else if (data.action === "approve") {
          // Only what the reader was sure of and that repeats nothing; the rest
          // needs a person to look at it.
          if (!review.bulkApprovable(row)) {
            result.skipped++;
            continue;
          }
          const done = await review.approveCandidate(
            admin,
            {
              create: (input) => createUnclaimedListingRecord(context.supabase, input),
              reviewerId: context.userId,
              nowIso,
            },
            { id },
          );
          await writeAudit(admin, context.userId, {
            action: "discovery.approve",
            targetType: done.subjectType === "team" ? "team" : "org",
            targetId: done.listingId,
            after: {
              candidateId: id,
              name: row.name,
              type: row.subject_type,
              sourceUrl: row.source_url,
              bulk: true,
            },
          });
        } else {
          await review.rejectCandidate(admin, { reviewerId: context.userId, nowIso }, { id });
          await writeAudit(admin, context.userId, {
            action: "discovery.reject",
            targetType: "listing_candidate",
            targetId: id,
            before: { name: row.name, type: row.subject_type, sourceUrl: row.source_url },
            metadata: { bulk: true },
          });
        }
        result.done++;
      } catch (e) {
        result.failed.push({ name, error: e instanceof Error ? e.message : "Failed" });
      }
    }
    return result;
  });

export const superadminDiscoveryIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      status: "pending" | "approved" | "rejected";
      type?: (typeof DISCOVERY_TYPES)[number];
      search?: string;
    }) =>
      z
        .object({
          status: z.enum(["pending", "approved", "rejected"]),
          type: z.enum(DISCOVERY_TYPES).optional(),
          search: z.string().max(120).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { listCandidateIds, SELECT_ALL_MAX } = await import("@/lib/discovery/review.server");
    const found = await listCandidateIds(admin, data);
    return { ...found, max: SELECT_ALL_MAX };
  });
