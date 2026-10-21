/**
 * Reviewing discovered candidates (server only).
 *
 * Approving creates an ordinary unclaimed listing through the same database
 * functions the admin "create unclaimed listing" form uses, then links the
 * candidate to it. The candidate is claimed first (pending → approved), so two
 * people approving at once cannot create it twice; if creating fails, it goes
 * back to pending. Rejections are remembered, so a rejected find is not offered
 * again by later runs.
 */

import { z } from "zod";
import { ORG_CATEGORIES } from "@/lib/org-listing";
import { SPORTS } from "@/lib/sample-data";
import { DISCOVERY_TYPES, type DiscoveryType } from "@/lib/discovery/areas";
import { handleCandidates } from "@/lib/discovery/match";
import { normalizeWebUrl } from "@/lib/discovery/urls";
import type { UnclaimedListingInput } from "@/lib/listings-create.server";

/** The service-role client; its generated types don't cover these tables. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const CANDIDATE_STATUSES = ["pending", "approved", "rejected"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/** Bulk approval only takes finds the reader was this sure of and that repeat nothing. */
export const BULK_APPROVE_MIN_CONFIDENCE = 0.75;
export const BULK_MAX = 50;

export type CandidateRow = {
  id: string;
  subject_type: DiscoveryType;
  name: string;
  city: string | null;
  state: string | null;
  address: string | null;
  website: string | null;
  sports: string[];
  category: string | null;
  description: string | null;
  source: "osm" | "search";
  source_url: string;
  confidence: number;
  duplicate_of: { kind: string; id: string; name: string; score: number } | null;
  status: CandidateStatus;
  reject_reason: string | null;
  created_listing_id: string | null;
  created_at: string;
};

const COLUMNS =
  "id, subject_type, name, city, state, address, website, sports, category, description, source, source_url, confidence, duplicate_of, status, reject_reason, created_listing_id, created_at";

export const CANDIDATE_EDITS = z
  .object({
    name: z.string().trim().min(2).max(120),
    city: z.string().trim().max(120).nullable(),
    address: z.string().trim().max(240).nullable(),
    website: z
      .string()
      .trim()
      .max(240)
      .nullable()
      .refine(
        (v) => v === null || v === "" || normalizeWebUrl(v) !== null,
        "Enter a valid website",
      ),
    sports: z
      .array(z.string())
      .max(6)
      .refine((v) => v.every((s) => SPORTS.some((k) => k.name === s)), "Unknown sport"),
    category: z
      .string()
      .nullable()
      .refine(
        (v) => v === null || (ORG_CATEGORIES as readonly string[]).includes(v),
        "Unknown category",
      ),
  })
  .partial();
export type CandidateEdits = z.infer<typeof CANDIDATE_EDITS>;

export async function listCandidates(
  admin: Db,
  input: {
    status: CandidateStatus;
    type?: DiscoveryType;
    search?: string;
    limit: number;
    offset: number;
  },
): Promise<{
  rows: CandidateRow[];
  total: number;
  counts: Record<CandidateStatus, number>;
}> {
  let q = admin
    .from("listing_candidates")
    .select(COLUMNS, { count: "exact" })
    .eq("status", input.status)
    .order("confidence", { ascending: false })
    .order("created_at", { ascending: false })
    .range(input.offset, input.offset + input.limit - 1);
  if (input.type) q = q.eq("subject_type", input.type);
  const term = (input.search ?? "").replace(/[%,()]/g, " ").trim();
  if (term) q = q.or(`name.ilike.%${term}%,city.ilike.%${term}%`);
  const { data, count, error } = await q;
  if (error) throw new Error(error.message);

  const counts = { pending: 0, approved: 0, rejected: 0 } as Record<CandidateStatus, number>;
  await Promise.all(
    CANDIDATE_STATUSES.map(async (status) => {
      const { count: n } = await admin
        .from("listing_candidates")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      counts[status] = n ?? 0;
    }),
  );
  return { rows: (data ?? []) as CandidateRow[], total: count ?? 0, counts };
}

/** One candidate, or null when it no longer exists. */
export async function getCandidate(admin: Db, id: string): Promise<CandidateRow | null> {
  const { data, error } = await admin
    .from("listing_candidates")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CandidateRow | null) ?? null;
}

async function loadCandidate(admin: Db, id: string): Promise<CandidateRow> {
  const found = await getCandidate(admin, id);
  if (!found) throw new Error("That find no longer exists.");
  return found;
}

const RETRY_HANDLE = /HANDLE_TAKEN|ID_TAKEN|duplicate key|unique/i;

/** The unclaimed-listing input for a candidate, with any edits applied. */
export function listingInputFor(
  c: CandidateRow,
  edits: CandidateEdits,
  handle: string,
): UnclaimedListingInput {
  const name = edits.name ?? c.name;
  const city = (edits.city !== undefined ? edits.city : c.city) ?? undefined;
  const website = normalizeWebUrl(edits.website !== undefined ? edits.website : c.website);
  if (c.subject_type === "gym") {
    const address = (edits.address !== undefined ? edits.address : c.address) ?? undefined;
    const category = (edits.category !== undefined ? edits.category : c.category) ?? undefined;
    return {
      subjectType: "gym",
      name,
      handle,
      city,
      category,
      address,
      website: website ?? undefined,
    };
  }
  return {
    subjectType: "team",
    kind: c.subject_type === "coach" ? "coach" : "team",
    name,
    handle,
    city,
    sports: edits.sports ?? c.sports,
  };
}

export type ApproveResult = { listingId: string; subjectType: "team" | "gym" };

export async function approveCandidate(
  admin: Db,
  deps: {
    /** Creates the listing with the reviewer's own client (see listings-create.server). */
    create: (input: UnclaimedListingInput) => Promise<{ id: string; subjectType: "team" | "gym" }>;
    reviewerId: string;
    nowIso: string;
  },
  input: { id: string; edits?: CandidateEdits; confirmDuplicate?: boolean },
): Promise<ApproveResult & { candidate: CandidateRow }> {
  const edits = CANDIDATE_EDITS.parse(input.edits ?? {});
  const candidate = await loadCandidate(admin, input.id);
  if (candidate.status !== "pending") throw new Error("This find was already reviewed.");
  if (candidate.duplicate_of && !input.confirmDuplicate) {
    throw new Error(`This may repeat "${candidate.duplicate_of.name}". Confirm to add it anyway.`);
  }

  // Claim it before creating anything, so a second approval stops here.
  const { data: claimed, error: claimError } = await admin
    .from("listing_candidates")
    .update({ status: "approved", reviewed_by: deps.reviewerId, reviewed_at: deps.nowIso })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select("id");
  if (claimError) throw new Error(claimError.message);
  if (!claimed?.length) throw new Error("This find was already reviewed.");

  const name = edits.name ?? candidate.name;
  const city = edits.city !== undefined ? edits.city : candidate.city;
  try {
    let lastError: Error | null = null;
    for (const handle of handleCandidates(name, city)) {
      try {
        const made = await deps.create(listingInputFor(candidate, edits, handle));
        await admin
          .from("listing_candidates")
          .update({ created_listing_id: made.id })
          .eq("id", candidate.id);
        return { listingId: made.id, subjectType: made.subjectType, candidate };
      } catch (e) {
        lastError = e instanceof Error ? e : new Error("Could not create the listing.");
        if (!RETRY_HANDLE.test(lastError.message)) break;
      }
    }
    throw lastError ?? new Error("Could not create the listing.");
  } catch (e) {
    // Put it back so it can be tried again.
    await admin
      .from("listing_candidates")
      .update({ status: "pending", reviewed_by: null, reviewed_at: null })
      .eq("id", candidate.id);
    throw e;
  }
}

export async function rejectCandidate(
  admin: Db,
  deps: { reviewerId: string; nowIso: string },
  input: { id: string; reason?: string },
): Promise<CandidateRow> {
  const candidate = await loadCandidate(admin, input.id);
  if (candidate.status !== "pending") throw new Error("This find was already reviewed.");
  const { data, error } = await admin
    .from("listing_candidates")
    .update({
      status: "rejected",
      reject_reason: (input.reason ?? "").trim().slice(0, 200) || null,
      reviewed_by: deps.reviewerId,
      reviewed_at: deps.nowIso,
    })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("This find was already reviewed.");
  return candidate;
}

/** Whether a candidate may be approved in bulk, without a person looking at it. */
export function bulkApprovable(c: Pick<CandidateRow, "status" | "confidence" | "duplicate_of">) {
  return (
    c.status === "pending" && c.confidence >= BULK_APPROVE_MIN_CONFIDENCE && c.duplicate_of === null
  );
}

export const DISCOVERY_TYPE_ENUM = z.enum(DISCOVERY_TYPES);
