/**
 * Superadmin Live Listings: the public, user-made listings (games, tryouts and
 * camps, player availability) in one place, with in-place edits.
 *
 * Hide/unhide is not here: the tab calls superadminModerate, which already sets
 * `hidden_at` and audits it, so there is one code path for hiding a listing.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSuperadmin, buildOrFilter, getAdmin, writeAudit } from "@/lib/superadmin.server";
import {
  EDIT_SCHEMAS,
  availabilityColumns,
  LISTING_SECTIONS,
  LISTING_VISIBILITY,
  TRYOUT_KINDS,
  changedFields,
  gameSideEffects,
  sportFromSearch,
  type ListingRow,
  type ListingSection,
} from "@/lib/live-listings";

/** The service-role client; its table types don't reach these dynamic queries. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminDb = any;

const SECTION_TABLE: Record<ListingSection, string> = {
  games: "hosted_games",
  tryouts: "team_posts",
  availability: "player_availabilities",
};

const SECTION_SELECT: Record<ListingSection, string> = {
  games:
    "id, title, sport, date, ends_at, location, neighborhood, host_id, status, joined, max_players, joins_closed, is_private, hidden_at, cancelled_at, completed_at, created_at",
  tryouts:
    "id, team_id, author_id, kind, title, body, event_date, location, spots_max, spots_taken, hidden_at, moderation_status, created_at, team:teams(name, handle)",
  availability:
    "id, user_id, sports, skill_level, skill_levels, looking_for, city, status, note, starts_on, ends_on, hidden_at, created_at",
};

/** Who a listing belongs to: the game host or the availability's player. */
const OWNER_COL: Partial<Record<ListingSection, string>> = {
  games: "host_id",
  availability: "user_id",
};

/** Ids of people or teams whose name matches, so a search can find "by host/team". */
async function matchingIds(admin: AdminDb, table: "profiles" | "teams", search: string) {
  const cols = table === "profiles" ? ["display_name", "username"] : ["name", "handle"];
  const or = buildOrFilter(cols, search);
  if (!or) return [];
  const { data } = await admin.from(table).select("id").or(or).limit(50);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

export const superadminListListings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      section: ListingSection;
      search?: string;
      visibility?: (typeof LISTING_VISIBILITY)[number];
      limit?: number;
      offset?: number;
    }) =>
      z
        .object({
          section: z.enum(LISTING_SECTIONS),
          search: z.string().max(120).optional(),
          visibility: z.enum(LISTING_VISIBILITY).default("visible"),
          limit: z.number().int().min(1).max(100).default(25),
          offset: z.number().int().min(0).default(0),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = (await getAdmin()) as AdminDb;
    const { section } = data;
    const nowIso = new Date().toISOString();
    const today = nowIso.slice(0, 10);

    let q = admin
      .from(SECTION_TABLE[section])
      .select(SECTION_SELECT[section], { count: "exact" })
      .range(data.offset, data.offset + data.limit - 1);

    if (section === "tryouts") q = q.in("kind", TRYOUT_KINDS as unknown as string[]);

    // Visible means still live: not hidden and not over. Past ignores hiding.
    const whenCol = section === "games" ? "date" : section === "tryouts" ? "event_date" : null;
    // A team post whose text is held or not yet screened is not public either,
    // so it counts as hidden here, not visible.
    if (data.visibility === "hidden") {
      q =
        section === "tryouts"
          ? q.or("hidden_at.not.is.null,moderation_status.neq.approved")
          : q.not("hidden_at", "is", null);
    }
    if (data.visibility === "visible") {
      q = q.is("hidden_at", null);
      if (section === "tryouts") q = q.eq("moderation_status", "approved");
      if (section === "games") {
        // Still on, or not started: a game in progress stays live until it ends.
        q = q
          .or(`date.gte.${nowIso},ends_at.gte.${nowIso}`)
          .is("cancelled_at", null)
          .is("completed_at", null)
          // Cancelling from the Content tab sets only status, not cancelled_at.
          .or("status.is.null,status.neq.cancelled");
      } else if (whenCol) {
        q = q.or(`${whenCol}.is.null,${whenCol}.gte.${nowIso}`);
      }
      if (section === "availability") {
        q = q.eq("status", "open").or(`ends_on.is.null,ends_on.gte.${today}`);
      }
    }
    if (data.visibility === "past") {
      if (section === "games") {
        q = q.lt("date", nowIso).or(`ends_at.is.null,ends_at.lt.${nowIso}`);
      } else if (whenCol) {
        q = q.lt(whenCol, nowIso);
      }
      if (section === "availability") q = q.or(`status.eq.closed,ends_on.lt.${today}`);
    }

    const search = (data.search ?? "").trim();
    if (search) {
      const textCols =
        section === "games"
          ? ["title", "location", "neighborhood", "sport"]
          : section === "tryouts"
            ? ["title", "body", "location"]
            : ["city", "note", "skill_level"];
      const parts: string[] = [];
      const text = buildOrFilter(textCols, search);
      if (text) parts.push(text);
      const sport = sportFromSearch(search);
      if (sport && section === "availability") parts.push(`sports.cs.{${sport}}`);
      const ownerCol = OWNER_COL[section];
      const ownerIds =
        section === "tryouts"
          ? await matchingIds(admin, "teams", search)
          : await matchingIds(admin, "profiles", search);
      if (ownerIds.length) {
        parts.push(`${ownerCol ?? "team_id"}.in.(${ownerIds.join(",")})`);
      }
      if (parts.length) q = q.or(parts.join(","));
    }

    // Upcoming first for live listings; most recent first for everything else.
    const sortCol = whenCol ?? "created_at";
    q = q.order(sortCol, {
      ascending: data.visibility === "visible" && !!whenCol,
      nullsFirst: false,
    });

    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as ListingRow[];

    // Owner names for the cards (team names come embedded with the post).
    const ownerCol = OWNER_COL[section];
    const ownerIds = ownerCol ? [...new Set(list.map((r) => r[ownerCol]).filter(Boolean))] : [];
    const names = new Map<string, string>();
    if (ownerIds.length) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, display_name, username")
        .in("id", ownerIds);
      for (const p of (profiles ?? []) as ListingRow[]) {
        names.set(p.id, p.display_name || (p.username ? `@${p.username}` : "Unknown"));
      }
    }

    return {
      total: count ?? 0,
      rows: list.map((r) => ({
        ...r,
        owner_name: ownerCol ? (names.get(r[ownerCol]) ?? null) : (r.team?.name ?? null),
      })),
    };
  });

export const superadminUpdateListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { section: ListingSection; id: string; patch: Record<string, unknown>; reason?: string }) =>
      z
        .object({
          section: z.enum(LISTING_SECTIONS),
          id: z.string().uuid(),
          patch: z.record(z.string(), z.unknown()),
          reason: z.string().max(500).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = (await getAdmin()) as AdminDb;
    const { section, id } = data;
    const parsed = EDIT_SCHEMAS[section].safeParse(data.patch);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid edit");

    const table = SECTION_TABLE[section];
    let read = admin.from(table).select("*").eq("id", id);
    if (section === "tryouts") read = read.in("kind", TRYOUT_KINDS as unknown as string[]);
    const { data: before, error: readErr } = await read.maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!before) throw new Error("Listing not found");

    const proposed =
      section === "availability"
        ? availabilityColumns(before, parsed.data as Record<string, unknown>)
        : (parsed.data as Record<string, unknown>);
    const changes = changedFields(before, proposed);
    if (Object.keys(changes).length === 0) return { ok: true, changed: [] as string[] };

    if (section === "games" && changes.max_players != null && changes.max_players < before.joined) {
      throw new Error(
        `${before.joined} players have already joined, so max players can't go below ${before.joined}.`,
      );
    }

    const update = { ...changes, ...(section === "games" ? gameSideEffects(before, changes) : {}) };
    const { error } = await admin.from(table).update(update).eq("id", id);
    if (error) throw new Error(error.message);

    await writeAudit(admin, context.userId, {
      action: `listings.${section}.edit`,
      targetType: section,
      targetId: id,
      reason: data.reason ?? null,
      before: Object.fromEntries(Object.keys(update).map((k) => [k, before[k] ?? null])),
      after: update,
    });

    await notifyScheduleChange(admin, section, before, changes);
    return { ok: true, changed: Object.keys(update) };
  });

/**
 * People signed up to a game or tryout hear when its time or place moves, as
 * they do when the host edits it. Best effort: a failed notice never undoes an edit.
 */
async function notifyScheduleChange(
  admin: AdminDb,
  section: ListingSection,
  before: ListingRow,
  changes: ListingRow,
) {
  try {
    const whenKey = section === "games" ? "date" : "event_date";
    const timeMoved = section !== "availability" && whenKey in changes;
    const placeMoved = section === "games" && "location" in changes;
    if (!timeMoved && !placeMoved) return;

    const { data: people } =
      section === "games"
        ? await admin.from("game_participants").select("user_id").eq("game_id", before.id)
        : await admin
            .from("tryout_rsvps")
            .select("user_id")
            .eq("post_id", before.id)
            .neq("status", "cancelled");
    const owner = section === "games" ? before.host_id : before.author_id;
    const targets = [
      ...new Set(((people ?? []) as { user_id: string }[]).map((p) => p.user_id)),
    ].filter((uid) => uid && uid !== owner);
    if (!targets.length) return;

    const title = changes.title ?? before.title;
    const bits: string[] = [];
    if (timeMoved && changes[whenKey]) {
      // Only games record their time zone; without one, a server-formatted
      // time could be hours off, so point people at the listing instead.
      let when: string | null = null;
      try {
        if (before.timezone) {
          when = new Date(changes[whenKey]).toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: before.timezone,
          });
        }
      } catch {
        when = null;
      }
      bits.push(
        when ? `New time: ${when}.` : "The time changed. Open the listing for the new time.",
      );
    }
    if (placeMoved) bits.push(`New location: ${changes.location}.`);
    const link = section === "games" ? `/games/${before.id}` : `/tryouts/${before.id}`;

    await admin.from("notifications").insert(
      targets.map((user_id) => ({
        user_id,
        type: "game_time_changed",
        title: `Updated: ${title}`,
        body: bits.join(" ") || "The schedule changed.",
        link,
      })),
    );
  } catch {
    /* best effort */
  }
}
