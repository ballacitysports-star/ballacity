import { supabase } from "@/integrations/supabase/client";
import {
  deriveLegacyFields,
  normalizeSlots,
  parseTimeSlots,
  type TimeSlot,
} from "./availability-timeslots";

export type PlaceGeo = {
  lat: number;
  lng: number;
  placeId?: string | null;
  formattedAddress?: string | null;
};

export type AvailabilityStatus = "open" | "closed";
export type ContactRequestStatus = "pending" | "accepted" | "declined" | "withdrawn";

export type PlayerAvailability = {
  id: string;
  user_id: string;
  sports: string[];
  skill_level: string;
  starts_on: string | null;
  ends_on: string | null;
  recurring_days: string[];
  city: string | null;
  /** Google Places details saved with the post so maps/distance stay accurate. */
  place_id: string | null;
  formatted_address: string | null;
  lat: number | null;
  lng: number | null;
  travel_radius_km: number;
  note: string | null;
  status: AvailabilityStatus;
  /** Individual dates and/or weekly windows with times. Superset of the legacy columns. */
  time_slots: TimeSlot[];
  timezone: string | null;
  created_at: string;
  updated_at: string;
};

export type AvailabilityWithAuthor = PlayerAvailability & {
  author_name: string;
  author_initials: string | null;
  author_avatar_url: string | null;
  author_age: number | null;
  /** Raw `profiles.sport_levels` jsonb for the author — profile tiers win over `skill_level`. */
  author_sport_levels: unknown;
  /** Author's profile bio / about text, for the About section on the player card. */
  author_bio: string | null;
  /** Author's home city from their profile. */
  author_city: string | null;
  /** Author's location search radius in miles (capped). */
  author_search_radius_mi: number | null;
};




export type AvailabilityContactRequest = {
  id: string;
  availability_id: string;
  from_user_id: string;
  to_user_id: string;
  message: string | null;
  status: ContactRequestStatus;
  created_at: string;
  updated_at: string;
};

export async function listOpenAvailabilities(
  opts: {
    sport?: string;
    /** Multi-sport filter — a post matches when it lists any of these. */
    sports?: string[];
    city?: string;
    includeAnywhere?: boolean;
    skill?: string;
    /** ISO date (YYYY-MM-DD) — only posts whose window overlaps [from, to] */
    from?: string;
    to?: string;
  } = {},
): Promise<AvailabilityWithAuthor[]> {
  let q = supabase
    .from("player_availabilities" as any)
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(100);
  const sportList = Array.from(
    new Set([...(opts.sports ?? []), ...(opts.sport ? [opts.sport] : [])].filter(Boolean)),
  );
  if (sportList.length === 1) q = q.contains("sports", [sportList[0]!]);
  else if (sportList.length > 1) q = q.overlaps("sports", sportList);
  if (opts.skill && opts.skill !== "All Levels") q = q.eq("skill_level", opts.skill);
  if (opts.city) {
    const pat = `%${opts.city.replace(/[%,()]/g, "")}%`;
    q = opts.includeAnywhere
      ? q.or(`city.ilike.${pat},city.is.null`)
      : q.ilike("city", pat);
  }
  // Time-window overlap: post.starts_on <= to AND post.ends_on >= from,
  // treating null bounds as "open-ended".
  if (opts.to) q = q.or(`starts_on.is.null,starts_on.lte.${opts.to}`);
  if (opts.from) q = q.or(`ends_on.is.null,ends_on.gte.${opts.from}`);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as unknown as PlayerAvailability[];
  if (rows.length === 0) return [];
  const ids = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_initials, avatar_url, sport_levels")
    .in("id", ids);
  const { data: ageRows } = await (supabase.rpc as any)("profile_ages", { _ids: ids });
  const ageById: Record<string, number | null> = Object.fromEntries(
    ((ageRows ?? []) as { id: string; age: number | null }[]).map((r) => [r.id, r.age]),
  );
  const byId = Object.fromEntries(((profs ?? []) as any[]).map((p) => [p.id, p]));
  return rows.map((r) => ({
    ...r,
    author_name: byId[r.user_id]?.display_name ?? "Player",
    author_initials: byId[r.user_id]?.avatar_initials ?? null,
    author_avatar_url: byId[r.user_id]?.avatar_url ?? null,
    author_age: ageById[r.user_id] ?? null,
    author_sport_levels: byId[r.user_id]?.sport_levels ?? null,
  }));

}


export async function getAvailabilityById(id: string): Promise<AvailabilityWithAuthor | null> {
  const { data, error } = await supabase
    .from("player_availabilities" as any)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as PlayerAvailability;
  const { data: prof } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_initials, avatar_url, sport_levels")
    .eq("id", row.user_id)
    .maybeSingle();
  return {
    ...row,
    author_name: (prof as any)?.display_name ?? "Player",
    author_initials: (prof as any)?.avatar_initials ?? null,
    author_avatar_url: (prof as any)?.avatar_url ?? null,
    author_sport_levels: (prof as any)?.sport_levels ?? null,
    author_age: await profileAge(row.user_id),
  };
}


async function profileAge(userId: string): Promise<number | null> {
  const { data } = await (supabase.rpc as any)("profile_ages", { _ids: [userId] });
  return ((data ?? []) as { age: number | null }[])[0]?.age ?? null;
}

export async function listMyAvailabilities(): Promise<PlayerAvailability[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const { data, error } = await supabase
    .from("player_availabilities" as any)
    .select("*")
    .eq("user_id", u.user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PlayerAvailability[];
}

/**
 * Normalize `time_slots` and keep the legacy date/weekday columns in sync so
 * existing readers and SQL overlap filters keep working.
 */
function slotFields(input: Partial<PlayerAvailability>) {
  const slots = normalizeSlots(parseTimeSlots(input.time_slots ?? []));
  const legacy = deriveLegacyFields(slots, {
    starts_on: input.starts_on ?? null,
    ends_on: input.ends_on ?? null,
  });
  return {
    time_slots: slots,
    starts_on: legacy.starts_on,
    ends_on: legacy.ends_on,
    recurring_days: slots.length > 0 ? legacy.recurring_days : (input.recurring_days ?? []),
    timezone:
      input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
  };
}

export async function createAvailability(input: Partial<PlayerAvailability>) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to post availability.");
  const payload = {
    user_id: u.user.id,
    sports: input.sports ?? [],
    skill_level: input.skill_level ?? "All Levels",
    ...slotFields(input),
    city: input.city?.trim() || null,
    place_id: input.place_id ?? null,
    formatted_address: input.formatted_address ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    travel_radius_km: input.travel_radius_km ?? 25,
    note: input.note?.slice(0, 500) ?? null,
    status: "open" as AvailabilityStatus,
  };
  const { data, error } = await supabase
    .from("player_availabilities" as any)
    .insert(payload as any)
    .select("id")
    .single();
  if (error) throw error;
  return (data as any).id as string;
}

export async function updateAvailability(id: string, patch: Partial<PlayerAvailability>) {
  const body = patch.time_slots !== undefined ? { ...patch, ...slotFields(patch) } : patch;
  const { error } = await supabase
    .from("player_availabilities" as any)
    .update(body as any)
    .eq("id", id);
  if (error) throw error;

  // Best-effort: notify players who previously reached out about this post that
  // it was updated, so they can revisit the new details (times, sports, city…).
  try {
    await notifyInterestedOnEdit(id);
  } catch (e) {
    console.warn("availability edit notify failed", e);
  }
}

async function notifyInterestedOnEdit(availabilityId: string) {
  const { data: u } = await supabase.auth.getUser();
  const editorId = u.user?.id ?? null;

  const { data: reqs } = await supabase
    .from("availability_contact_requests" as any)
    .select("from_user_id")
    .eq("availability_id", availabilityId);
  const rows = (reqs ?? []) as unknown as { from_user_id: string }[];
  const recipients = Array.from(
    new Set(rows.map((r) => r.from_user_id).filter((id) => id && id !== editorId)),
  );
  if (recipients.length === 0) return;

  // Pull a friendly label for the notification body: editor's display name.
  let editorName = "A player";
  if (editorId) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", editorId)
      .maybeSingle();
    if (prof?.display_name) editorName = prof.display_name;
  }

  const { createNotification } = await import("@/lib/notifications");
  await Promise.all(
    recipients.map((uid) =>
      createNotification({
        user_id: uid,
        type: "availability_updated",
        title: `${editorName} updated their availability`,
        body: "Tap to see the new details.",
        link: `/players?post=${availabilityId}`,
      }),
    ),
  );
}

export async function deleteAvailability(id: string) {
  const { error } = await supabase
    .from("player_availabilities" as any)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export type InvitePayload = {
  gameId: string;
  title?: string | null;
  startsAt?: string | null; // ISO
  sport?: string | null;
  location?: string | null;
};

export async function createContactRequest(
  availabilityId: string,
  toUserId: string,
  message: string,
  invite?: InvitePayload | null,
) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to contact this player.");
  if (u.user.id === toUserId) throw new Error("You can't contact yourself.");
  const { error } = await supabase.from("availability_contact_requests" as any).insert({
    availability_id: availabilityId,
    from_user_id: u.user.id,
    to_user_id: toUserId,
    message: message.trim().slice(0, 500) || null,
    status: "pending",
    kind: invite ? "invite" : "contact",
    game_id: invite?.gameId ?? null,
    game_title: invite?.title ? invite.title.slice(0, 200) : null,
    game_starts_at: invite?.startsAt ?? null,
    game_sport: invite?.sport ? invite.sport.slice(0, 60) : null,
    game_location: invite?.location ? invite.location.slice(0, 300) : null,
  } as any);
  if (error) throw error;

  // Fire a best-effort in-app + push notification to the recipient.
  if (invite) {
    try {
      const { createNotification } = await import("@/lib/notifications");
      await createNotification({
        user_id: toUserId,
        type: "game_invite",
        title: `You're invited to ${invite.title ?? "a pickup game"}`,
        body: [invite.sport, invite.location].filter(Boolean).join(" · ") || null,
        link: `/games/${invite.gameId}?invite=1&from=${u.user.id}`,
      });
    } catch (e) {
      console.warn("invite notification failed", e);
    }
  }
}

export async function listMyContactRequests(
  box: "inbox" | "outbox",
): Promise<AvailabilityContactRequest[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const col = box === "inbox" ? "to_user_id" : "from_user_id";
  const { data, error } = await supabase
    .from("availability_contact_requests" as any)
    .select("*")
    .eq(col, u.user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AvailabilityContactRequest[];
}

export async function setContactRequestStatus(id: string, status: ContactRequestStatus) {
  const { error } = await supabase
    .from("availability_contact_requests" as any)
    .update({ status } as any)
    .eq("id", id);
  if (error) throw error;
}

/**
 * Cancel (delete) a pending contact/invite request that the current user sent.
 * Only works for pending rows the sender owns; RLS enforces `from_user_id = auth.uid()`.
 */
export async function cancelContactRequest(id: string) {
  const { error } = await supabase
    .from("availability_contact_requests" as any)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export type ExistingRequestStatus = "none" | "pending" | "accepted" | "declined" | "withdrawn";

export type ExistingRequestSummary = {
  status: ExistingRequestStatus;
  kind: "contact" | "invite" | null;
  game_id: string | null;
  updated_at: string | null;
  id: string | null;
};

/**
 * Look up the most recent contact/invite request from the current user to a
 * given availability. Optionally scope to a specific game_id (for invites).
 */
export async function getExistingContactRequest(
  availabilityId: string,
  opts: { gameId?: string | null } = {},
): Promise<ExistingRequestSummary> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { status: "none", kind: null, game_id: null, updated_at: null, id: null };
  let q = supabase
    .from("availability_contact_requests" as any)
    .select("id, status, kind, game_id, updated_at")
    .eq("availability_id", availabilityId)
    .eq("from_user_id", u.user.id)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (opts.gameId !== undefined) {
    q = opts.gameId === null ? q.is("game_id", null) : q.eq("game_id", opts.gameId);
  }
  const { data, error } = await q;
  if (error) throw error;
  const row = (data ?? [])[0] as any;
  if (!row) return { status: "none", kind: null, game_id: null, updated_at: null, id: null };
  return {
    status: row.status as ExistingRequestStatus,
    kind: row.kind as "contact" | "invite",
    game_id: row.game_id ?? null,
    updated_at: row.updated_at ?? null,
    id: row.id ?? null,
  };
}
