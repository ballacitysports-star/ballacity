import { supabase } from "@/integrations/supabase/client";

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
  travel_radius_km: number;
  note: string | null;
  status: AvailabilityStatus;
  created_at: string;
  updated_at: string;
};

export type AvailabilityWithAuthor = PlayerAvailability & {
  author_name: string;
  author_initials: string | null;
  author_birthday: string | null;
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

export async function listOpenAvailabilities(opts: { sport?: string; city?: string } = {}): Promise<AvailabilityWithAuthor[]> {
  let q = supabase
    .from("player_availabilities" as any)
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(100);
  if (opts.sport) q = q.contains("sports", [opts.sport]);
  if (opts.city) q = q.ilike("city", `%${opts.city}%`);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as unknown as PlayerAvailability[];
  if (rows.length === 0) return [];
  const ids = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_initials, birthday")
    .in("id", ids);
  const byId = Object.fromEntries(((profs ?? []) as any[]).map((p) => [p.id, p]));
  return rows.map((r) => ({
    ...r,
    author_name: byId[r.user_id]?.display_name ?? "Player",
    author_initials: byId[r.user_id]?.avatar_initials ?? null,
    author_birthday: byId[r.user_id]?.birthday ?? null,
  }));
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

export async function createAvailability(input: Partial<PlayerAvailability>) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to post availability.");
  const payload = {
    user_id: u.user.id,
    sports: input.sports ?? [],
    skill_level: input.skill_level ?? "All Levels",
    starts_on: input.starts_on ?? null,
    ends_on: input.ends_on ?? null,
    recurring_days: input.recurring_days ?? [],
    city: input.city?.trim() || null,
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
  const { error } = await supabase
    .from("player_availabilities" as any)
    .update(patch as any)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteAvailability(id: string) {
  const { error } = await supabase.from("player_availabilities" as any).delete().eq("id", id);
  if (error) throw error;
}

export async function createContactRequest(availabilityId: string, toUserId: string, message: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to contact this player.");
  if (u.user.id === toUserId) throw new Error("You can't contact yourself.");
  const { error } = await supabase
    .from("availability_contact_requests" as any)
    .insert({
      availability_id: availabilityId,
      from_user_id: u.user.id,
      to_user_id: toUserId,
      message: message.trim().slice(0, 500) || null,
      status: "pending",
    } as any);
  if (error) throw error;
}

export async function listMyContactRequests(box: "inbox" | "outbox"): Promise<AvailabilityContactRequest[]> {
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
