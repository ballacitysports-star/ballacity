import { supabase } from "@/integrations/supabase/client";

export type TrainerRequestStatus = "pending" | "accepted" | "declined" | "cancelled" | "completed";

export type TrainerSessionRequest = {
  id: string;
  trainer_id: string;
  from_user_id: string;
  to_user_id: string;
  session_type: string;
  preferred_date: string | null;
  preferred_start_time: string | null;
  duration_minutes: number;
  message: string | null;
  status: TrainerRequestStatus;
  responder_note: string | null;
  created_at: string;
  updated_at: string;
};

export type TrainerBookedSlot = {
  start: string; // "HH:MM" 24h
  end: string; // "HH:MM" 24h
  status: "pending" | "accepted";
};

const TABLE = "trainer_session_requests" as const;

/** Convert a Postgres TIME string ("HH:MM:SS") to "HH:MM". */
const trimSeconds = (t: string) => t.slice(0, 5);

/**
 * Read the trainer's booked slots (pending + accepted) for a given date.
 * Backed by a SECURITY DEFINER RPC that returns only start/end/status —
 * no participant identities are exposed.
 */
export async function listTrainerBookedSlots(
  trainerId: string,
  dateKey: string,
): Promise<TrainerBookedSlot[]> {
  const { data, error } = await supabase.rpc("list_trainer_booked_slots" as any, {
    _trainer_id: trainerId,
    _date: dateKey,
  });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    start: trimSeconds(String(r.start_time)),
    end: trimSeconds(String(r.end_time)),
    status: r.status as "pending" | "accepted",
  }));
}

export async function createTrainerSessionRequest(input: {
  trainerId: string;
  toUserId: string;
  sessionType: string;
  preferredDate: string | null;
  preferredStartTime: string | null;
  durationMinutes: number;
  message: string | null;
}): Promise<TrainerSessionRequest> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Please sign in to request a session.");
  if (u.user.id === input.toUserId) throw new Error("You can't request a session from yourself.");

  // Server-side conflict re-check (guards against races between UI check + insert).
  if (input.preferredDate && input.preferredStartTime) {
    const slots = await listTrainerBookedSlots(input.trainerId, input.preferredDate);
    const startMin = toMinutes(input.preferredStartTime);
    const endMin = startMin + input.durationMinutes;
    const overlap = slots.find((s) => {
      const a = toMinutes(s.start);
      const b = toMinutes(s.end);
      return startMin < b && endMin > a;
    });
    if (overlap) {
      throw new Error("This time just got booked — please pick another slot.");
    }
  }

  const { data, error } = await supabase
    .from(TABLE as any)
    .insert({
      trainer_id: input.trainerId,
      from_user_id: u.user.id,
      to_user_id: input.toUserId,
      session_type: input.sessionType,
      preferred_date: input.preferredDate,
      preferred_start_time: input.preferredStartTime,
      duration_minutes: input.durationMinutes,
      message: input.message?.trim() || null,
    } as any)
    .select("*")
    .single();

  if (error) {
    if ((error as any).code === "23505") {
      throw new Error("You already have a pending request with this trainer.");
    }
    throw error;
  }
  return data as unknown as TrainerSessionRequest;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export async function getMyPendingRequestForTrainer(
  trainerId: string,
): Promise<TrainerSessionRequest | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await supabase
    .from(TABLE as any)
    .select("*")
    .eq("trainer_id", trainerId)
    .eq("from_user_id", u.user.id)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as unknown as TrainerSessionRequest | undefined;
  return row ?? null;
}

export async function listMyTrainerRequests(
  box: "outbox" | "inbox",
): Promise<TrainerSessionRequest[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const col = box === "inbox" ? "to_user_id" : "from_user_id";
  const { data, error } = await supabase
    .from(TABLE as any)
    .select("*")
    .eq(col, u.user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as TrainerSessionRequest[];
}

export async function cancelTrainerSessionRequest(id: string) {
  const { error } = await supabase
    .from(TABLE as any)
    .update({ status: "cancelled" } as any)
    .eq("id", id);
  if (error) throw error;
}

export async function respondToTrainerSessionRequest(
  id: string,
  status: "accepted" | "declined" | "completed",
  responderNote?: string | null,
) {
  const { error } = await supabase
    .from(TABLE as any)
    .update({ status, responder_note: responderNote ?? null } as any)
    .eq("id", id);
  if (error) throw error;
}

type SharedSub = {
  channel: ReturnType<typeof supabase.channel>;
  listeners: Set<() => void>;
};
const sharedSubs = new Map<string, SharedSub>();

export function subscribeToMyTrainerRequests(userId: string, onChange: () => void) {
  let entry = sharedSubs.get(userId);
  if (!entry) {
    const listeners = new Set<() => void>();
    const fanout = () => listeners.forEach((cb) => cb());
    const channel = supabase
      .channel(`trainer-requests-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLE, filter: `from_user_id=eq.${userId}` },
        fanout,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLE, filter: `to_user_id=eq.${userId}` },
        fanout,
      )
      .subscribe();
    entry = { channel, listeners };
    sharedSubs.set(userId, entry);
  }
  entry.listeners.add(onChange);
  return () => {
    const current = sharedSubs.get(userId);
    if (!current) return;
    current.listeners.delete(onChange);
    if (current.listeners.size === 0) {
      supabase.removeChannel(current.channel);
      sharedSubs.delete(userId);
    }
  };
}
