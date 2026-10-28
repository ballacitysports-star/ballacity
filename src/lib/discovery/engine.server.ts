/**
 * Runs a discovery in small steps.
 *
 * A run is a list of lookups (web searches, a map query) followed by a list of
 * pages to read. Each call to {@link stepRun} does a few of them and saves its
 * place, so no request runs long and the Discovery tab simply keeps calling
 * until the run is done. A lock on the run stops two open tabs from running the
 * same step twice.
 *
 * Every candidate comes from reading an organization's own website. A search
 * result or map entry is only a lead (an address to read). Network access and
 * the AI call are passed in, so this module is exercised without either.
 */

import {
  areaById,
  osmTasks,
  searchTasks,
  DISCOVERY_TYPES,
  type DiscoveryArea,
  type DiscoveryTask,
  type DiscoveryType,
  type OsmLead,
} from "@/lib/discovery/areas";
import type { Extraction } from "@/lib/discovery/extract";
import type { PageText } from "@/lib/discovery/html";
import {
  EXACT_DUPLICATE,
  findDuplicate,
  fingerprint,
  type KnownListing,
} from "@/lib/discovery/match";
import { hostKey, normalizeWebUrl } from "@/lib/discovery/urls";

/** The service-role client; its generated types don't cover these tables. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type Lead = {
  url: string;
  source: "osm" | "search";
  /** Only a hint for the reader; never stored. */
  hint?: { name: string | null; sport: string | null } | null;
  /** 1 = found on a directory page; its own site is read but yields no further leads. */
  depth: 0 | 1;
};

export type RunStats = {
  leads: number;
  pagesRead: number;
  pagesSkipped: number;
  candidates: number;
  duplicates: number;
  errors: number;
  aiCalls: number;
};

type RunRow = {
  id: string;
  created_by: string | null;
  area_id: string;
  types: DiscoveryType[];
  status: "running" | "done" | "failed" | "cancelled";
  tasks: DiscoveryTask[];
  pages: Lead[];
  seen_hosts: string[];
  max_pages: number;
  pages_done: number;
  stats: Partial<RunStats>;
  log: string[];
  error: string | null;
  lock_until: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type RunSummary = {
  id: string;
  status: RunRow["status"];
  areaLabel: string;
  types: DiscoveryType[];
  tasksLeft: number;
  pagesLeft: number;
  pagesDone: number;
  maxPages: number;
  stats: RunStats;
  log: string[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** True when another step holds the lock; nothing was done. */
  busy: boolean;
};

export type DiscoveryDeps = {
  now: () => number;
  searchEnabled: boolean;
  searchWeb: (q: string, limit: number) => Promise<{ url: string }[]>;
  osmLeads: (area: DiscoveryArea, type: DiscoveryType) => Promise<OsmLead[]>;
  fetchPage: (
    url: string,
  ) => Promise<{ ok: true; url: string; page: PageText } | { ok: false; reason: string }>;
  extract: (input: {
    area: DiscoveryArea;
    types: readonly DiscoveryType[];
    pageUrl: string;
    page: PageText;
    hint?: Lead["hint"];
  }) => Promise<Extraction>;
  /** True for AI errors that would repeat on every page (quota, switched off). */
  isFatalError: (message: string) => boolean;
};

export const TASKS_PER_STEP = 3;
export const PAGES_PER_STEP = 2;
export const STEP_BUDGET_MS = 25_000;
const LOCK_MS = 90_000;
const STALE_RUN_MS = 60 * 60 * 1000;
const MAX_QUEUE = 400;
const SEARCH_LIMIT = 10;
const REVISIT_DAYS = 30;
const LOG_KEEP = 40;
export const DEFAULT_MAX_PAGES = 80;

const emptyStats = (): RunStats => ({
  leads: 0,
  pagesRead: 0,
  pagesSkipped: 0,
  candidates: 0,
  duplicates: 0,
  errors: 0,
  aiCalls: 0,
});

export function summarizeRun(run: RunRow, busy = false): RunSummary {
  return {
    id: run.id,
    status: run.status,
    areaLabel: areaById(run.area_id)?.label ?? run.area_id,
    types: run.types,
    tasksLeft: run.tasks.length,
    pagesLeft: run.pages.length,
    pagesDone: run.pages_done,
    maxPages: run.max_pages,
    stats: { ...emptyStats(), ...run.stats },
    log: run.log.slice(-12),
    error: run.error,
    startedAt: run.created_at,
    finishedAt: run.finished_at,
    busy,
  };
}

/* --------------------------------- start --------------------------------- */

export async function startRun(
  admin: Db,
  deps: Pick<DiscoveryDeps, "searchEnabled" | "now">,
  input: { userId: string; areaId: string; types: string[]; maxPages?: number },
): Promise<RunSummary> {
  const area = areaById(input.areaId);
  if (!area) throw new Error("Unknown area.");
  const types = DISCOVERY_TYPES.filter((t) => input.types.includes(t));
  if (!types.length) throw new Error("Pick at least one type to look for.");
  const maxPages = Math.max(1, Math.min(200, Math.round(input.maxPages ?? DEFAULT_MAX_PAGES)));

  const { data: running } = await admin
    .from("listing_discovery_runs")
    .select("id, updated_at")
    .eq("status", "running");
  for (const r of (running ?? []) as { id: string; updated_at: string }[]) {
    if (deps.now() - Date.parse(r.updated_at) < STALE_RUN_MS) {
      throw new Error("A discovery run is already in progress. Wait for it to finish or stop it.");
    }
    await admin
      .from("listing_discovery_runs")
      .update({
        status: "failed",
        error: "Stopped: no progress for an hour.",
        finished_at: new Date(deps.now()).toISOString(),
      })
      .eq("id", r.id);
  }

  const tasks: DiscoveryTask[] = [
    ...osmTasks(types),
    ...(deps.searchEnabled ? searchTasks(area, types) : []),
  ];
  const log = deps.searchEnabled
    ? []
    : ["Web search is off (FIRECRAWL_API_KEY is not set), so only map listings will be checked."];

  const { data, error } = await admin
    .from("listing_discovery_runs")
    .insert({
      created_by: input.userId,
      area_id: area.id,
      types,
      tasks,
      max_pages: maxPages,
      stats: emptyStats(),
      log,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return summarizeRun(data as RunRow);
}

export async function cancelRun(admin: Db, runId: string, nowMs: number): Promise<void> {
  const { error } = await admin
    .from("listing_discovery_runs")
    .update({ status: "cancelled", lock_until: null, finished_at: new Date(nowMs).toISOString() })
    .eq("id", runId)
    .eq("status", "running");
  if (error) throw new Error(error.message);
}

/* ---------------------------------- step --------------------------------- */

async function loadKnown(admin: Db): Promise<{
  teams: KnownListing[];
  coaches: KnownListing[];
  gyms: KnownListing[];
  candidates: Record<DiscoveryType, KnownListing[]>;
}> {
  const [teams, orgs, cands] = await Promise.all([
    admin.from("teams").select("id, name, city, kind").limit(5000),
    admin.from("trainer_orgs").select("id, name, city, website").limit(5000),
    admin.from("listing_candidates").select("id, name, city, website, subject_type").limit(5000),
  ]);
  const coachKinds = new Set(["coach", "trainer"]);
  const asTeam = (r: { id: string; name: string; city: string | null }): KnownListing => ({
    kind: "team",
    id: String(r.id),
    name: r.name,
    city: r.city ?? null,
  });
  const rows = (teams.data ?? []) as {
    id: string;
    name: string;
    city: string | null;
    kind: string;
  }[];
  const candidates: Record<DiscoveryType, KnownListing[]> = { gym: [], team: [], coach: [] };
  for (const c of (cands.data ?? []) as {
    id: string;
    name: string;
    city: string | null;
    website: string | null;
    subject_type: DiscoveryType;
  }[]) {
    candidates[c.subject_type]?.push({
      kind: "candidate",
      id: c.id,
      name: c.name,
      city: c.city,
      website: c.website,
    });
  }
  return {
    teams: rows.filter((r) => !coachKinds.has(r.kind)).map(asTeam),
    coaches: rows.filter((r) => coachKinds.has(r.kind)).map(asTeam),
    gyms: (
      (orgs.data ?? []) as {
        id: string;
        name: string;
        city: string | null;
        website: string | null;
      }[]
    ).map((r) => ({
      kind: "gym" as const,
      id: String(r.id),
      name: r.name,
      city: r.city ?? null,
      website: r.website,
    })),
    candidates,
  };
}

/** Hosts read within the revisit window that did not fail, so they are not read again. */
async function recentlyReadHosts(admin: Db, hosts: string[], nowMs: number): Promise<Set<string>> {
  if (!hosts.length) return new Set();
  const since = new Date(nowMs - REVISIT_DAYS * 86_400_000).toISOString();
  const { data } = await admin
    .from("listing_discovery_pages")
    .select("host, outcome")
    .in("host", hosts)
    .gte("fetched_at", since);
  return new Set(
    ((data ?? []) as { host: string; outcome: string }[])
      .filter((r) => r.outcome !== "error")
      .map((r) => r.host),
  );
}

export async function stepRun(
  admin: Db,
  deps: DiscoveryDeps,
  input: { runId: string; userId: string },
): Promise<RunSummary> {
  const started = deps.now();
  const nowIso = new Date(started).toISOString();

  // Take the lock; if another step holds it, report where things stand.
  const { data: claimed } = await admin
    .from("listing_discovery_runs")
    .update({ lock_until: new Date(started + LOCK_MS).toISOString() })
    .eq("id", input.runId)
    .eq("status", "running")
    .or(`lock_until.is.null,lock_until.lt.${nowIso}`)
    .select("*");
  const run = ((claimed ?? [])[0] ?? null) as RunRow | null;
  if (!run) {
    const { data: current } = await admin
      .from("listing_discovery_runs")
      .select("*")
      .eq("id", input.runId)
      .maybeSingle();
    if (!current) throw new Error("That run no longer exists.");
    return summarizeRun(current as RunRow, (current as RunRow).status === "running");
  }

  const area = areaById(run.area_id);
  if (!area) throw new Error("This run's area is no longer configured.");

  const stats: RunStats = { ...emptyStats(), ...run.stats };
  const log = [...run.log];
  const note = (line: string) => log.push(line.slice(0, 200));
  const seen = new Set(run.seen_hosts);
  const tasks = [...run.tasks];
  let pages = [...run.pages];
  let pagesDone = run.pages_done;
  let status: RunRow["status"] = "running";
  let error: string | null = null;
  const timeLeft = () => deps.now() - started < STEP_BUDGET_MS;

  const enqueue = async (leads: Lead[]) => {
    const fresh: Lead[] = [];
    for (const lead of leads) {
      const url = normalizeWebUrl(lead.url);
      if (!url) continue;
      const host = hostKey(url);
      if (!host || seen.has(host)) continue;
      seen.add(host);
      fresh.push({ ...lead, url });
    }
    const already = await recentlyReadHosts(
      admin,
      fresh.map((l) => hostKey(l.url)),
      started,
    );
    for (const lead of fresh) {
      if (already.has(hostKey(lead.url))) continue;
      if (pages.length >= MAX_QUEUE) break;
      pages.push(lead);
      stats.leads++;
    }
  };

  try {
    if (tasks.length) {
      // Phase 1: searches and map lookups, which produce the pages to read.
      for (let i = 0; i < TASKS_PER_STEP && tasks.length && timeLeft(); i++) {
        const task = tasks.shift()!;
        try {
          if (task.kind === "osm") {
            const found = await deps.osmLeads(area, task.type);
            await enqueue(
              found.map((l) => ({
                url: l.website,
                source: "osm",
                depth: 0,
                hint: { name: l.hintName, sport: l.hintSport },
              })),
            );
            note(
              `Map: ${found.length} listed ${task.type === "gym" ? "facilities" : "clubs"} with a website`,
            );
          } else {
            const hits = await deps.searchWeb(task.q, SEARCH_LIMIT);
            await enqueue(hits.map((h) => ({ url: h.url, source: "search", depth: 0 })));
            note(`Search "${task.q}": ${hits.length} results`);
          }
        } catch (e) {
          stats.errors++;
          note(
            `${task.kind === "osm" ? "Map lookup" : `Search "${task.q}"`} failed: ${e instanceof Error ? e.message : "error"}`,
          );
        }
        // A map lookup can try several servers, so it gets the whole step.
        if (task.kind === "osm") break;
      }
    } else if (pages.length && pagesDone < run.max_pages) {
      // Phase 2: read pages and turn what they say into candidates.
      const known = await loadKnown(admin);
      for (
        let i = 0;
        i < PAGES_PER_STEP && pages.length && pagesDone < run.max_pages && timeLeft();
        i++
      ) {
        const lead = pages.shift()!;
        pagesDone++;
        const host = hostKey(lead.url);
        const record = (outcome: string, candidates = 0) =>
          admin.from("listing_discovery_pages").upsert(
            {
              url: lead.url,
              host,
              run_id: run.id,
              outcome,
              candidates,
              fetched_at: new Date(deps.now()).toISOString(),
            },
            { onConflict: "url" },
          );

        const got = await deps.fetchPage(lead.url);
        if (!got.ok) {
          stats.pagesSkipped++;
          note(`${host}: skipped (${got.reason})`);
          await record(
            got.reason.startsWith("HTTP 5") || got.reason === "timed out" ? "error" : "skipped",
          );
          continue;
        }
        stats.pagesRead++;

        let extraction: Extraction;
        try {
          extraction = await deps.extract({
            area,
            types: run.types,
            pageUrl: got.url,
            page: got.page,
            hint: lead.hint,
          });
          stats.aiCalls++;
        } catch (e) {
          const message = e instanceof Error ? e.message : "AI read failed";
          if (deps.isFatalError(message)) {
            status = "failed";
            error = message;
            pages.unshift(lead);
            pagesDone--;
            break;
          }
          stats.errors++;
          note(`${host}: could not be read (${message.slice(0, 80)})`);
          await record("error");
          continue;
        }

        if (extraction.pageKind === "directory") {
          if (lead.depth === 0) {
            await enqueue(
              extraction.orgs.map((o) => ({
                url: o.website ?? "",
                source: lead.source,
                depth: 1 as const,
                hint: { name: o.name, sport: o.sports[0] ?? null },
              })),
            );
            note(`${host}: directory page, ${extraction.orgs.length} sites to check`);
          }
          await record("directory");
          continue;
        }
        if (extraction.pageKind === "other" || !extraction.orgs.length) {
          for (const why of extraction.dropped.slice(0, 2)) note(`${host}: ${why}`);
          await record("no-match");
          continue;
        }

        let saved = 0;
        for (const org of extraction.orgs) {
          const pool =
            org.type === "gym" ? known.gyms : org.type === "team" ? known.teams : known.coaches;
          const dup = findDuplicate(
            {
              name: org.name,
              city: org.city,
              websiteHost: org.website ? hostKey(org.website) : undefined,
            },
            [...pool, ...known.candidates[org.type]],
            hostKey,
          );
          const exact = dup && dup.score >= EXACT_DUPLICATE ? dup : null;
          if (exact?.kind === "candidate") {
            stats.duplicates++;
            continue;
          }
          const alreadyListed = exact;
          const { data: inserted, error: insertError } = await admin
            .from("listing_candidates")
            .upsert(
              {
                run_id: run.id,
                subject_type: org.type,
                name: org.name,
                city: org.city,
                state: org.state,
                address: org.address,
                website: org.website,
                sports: org.sports,
                category: org.category,
                description: org.description,
                source: lead.source,
                source_url: got.url,
                confidence: org.confidence,
                fingerprint: fingerprint(org.type, org.name, org.city),
                duplicate_of: dup,
                status: alreadyListed ? "rejected" : "pending",
                reject_reason: alreadyListed ? `Already listed: ${alreadyListed.name}` : null,
              },
              { onConflict: "subject_type,fingerprint", ignoreDuplicates: true },
            )
            .select("id");
          if (insertError) {
            stats.errors++;
            note(`${host}: could not save ${org.name} (${insertError.message.slice(0, 60)})`);
            continue;
          }
          if (!inserted?.length || alreadyListed) {
            stats.duplicates++;
            continue;
          }
          stats.candidates++;
          saved++;
          known.candidates[org.type].push({
            kind: "candidate",
            id: String(inserted[0].id),
            name: org.name,
            city: org.city,
            website: org.website,
          });
        }
        await record("ok", saved);
        note(`${host}: ${saved} found`);
      }
    }

    if (status === "running") {
      if (!tasks.length && (!pages.length || pagesDone >= run.max_pages)) {
        if (pages.length) note("Stopped at the page limit.");
        pages = [];
        status = "done";
        if (stats.pagesRead === 0 && stats.leads === 0) {
          if (stats.errors > 0) {
            // Nothing was found because the lookups themselves failed: say so
            // rather than reporting a finished run with no results.
            status = "failed";
            error = deps.searchEnabled
              ? "Every lookup failed, so there was nothing to read. Try again in a few minutes."
              : "The map servers could not be reached and web search is off, so there was nothing to read. Try again in a few minutes, or add FIRECRAWL_API_KEY to turn on web search.";
          } else {
            note("No sites to read.");
          }
        }
      }
    }
  } catch (e) {
    status = "failed";
    error = e instanceof Error ? e.message : "The run stopped unexpectedly.";
  }

  const finished = status !== "running";
  const { data: saved, error: saveError } = await admin
    .from("listing_discovery_runs")
    .update({
      tasks,
      pages,
      seen_hosts: [...seen],
      pages_done: pagesDone,
      stats,
      log: log.slice(-LOG_KEEP),
      status,
      error,
      lock_until: null,
      updated_at: new Date(deps.now()).toISOString(),
      finished_at: finished ? new Date(deps.now()).toISOString() : null,
    })
    .eq("id", run.id)
    // A run stopped from another tab stays stopped.
    .eq("status", "running")
    .select("*");
  if (saveError) throw new Error(saveError.message);
  const row = ((saved ?? [])[0] ?? null) as RunRow | null;
  if (row) return summarizeRun(row);
  const { data: current } = await admin
    .from("listing_discovery_runs")
    .select("*")
    .eq("id", run.id)
    .maybeSingle();
  return summarizeRun((current ?? run) as RunRow);
}

export async function latestRun(admin: Db): Promise<RunSummary | null> {
  const { data } = await admin
    .from("listing_discovery_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1);
  const row = ((data ?? [])[0] ?? null) as RunRow | null;
  return row ? summarizeRun(row) : null;
}
