import { supabase } from "@/integrations/supabase/client";

export type PaymentType =
  | "venmo" | "cashapp" | "zelle" | "paypal"
  | "applecash" | "googlepay" | "cash" | "custom";

export type PaymentMethod = {
  id: string;
  host_id: string;
  payment_type: PaymentType;
  label: string | null;
  username: string | null;
  payment_url: string | null;
  contact_info: string | null;
  instructions: string | null;
  is_enabled: boolean;
};

export type GamePaymentSettings = {
  id: string;
  game_id: string;
  host_id: string;
  entry_fee: number;
  accepted_method_ids: string[];
  payment_deadline: string | null;
  refund_policy: string | null;
  payment_instructions: string | null;
  requires_approval: boolean;
};

export type JoinRequest = {
  id: string;
  game_id: string;
  player_id: string;
  host_id: string;
  status: "pending" | "approved" | "rejected";
  message: string | null;
  reviewer_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export type PaymentSubmission = {
  id: string;
  player_id: string;
  game_id: string;
  host_id: string;
  payment_method_id: string | null;
  payment_type: string | null;
  screenshot_path: string | null;
  transaction_reference: string | null;
  notes: string | null;
  status: "pending" | "verified" | "rejected";
  reviewer_notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
};

export const PAYMENT_TYPES: { id: PaymentType; name: string; emoji: string; fields: { username?: string; url?: string; contact?: string } }[] = [
  { id: "venmo", name: "Venmo", emoji: "💸", fields: { username: "Venmo username", url: "Payment URL (https://venmo.com/u/…)" } },
  { id: "cashapp", name: "Cash App", emoji: "💵", fields: { username: "Cashtag ($yourname)", url: "Payment URL (https://cash.app/$…)" } },
  { id: "zelle", name: "Zelle", emoji: "⚡", fields: { contact: "Email or phone" } },
  { id: "paypal", name: "PayPal F&F", emoji: "🅿️", fields: { username: "PayPal username", url: "PayPal.me link" } },
  { id: "applecash", name: "Apple Cash", emoji: "🍎", fields: { contact: "Phone number" } },
  { id: "googlepay", name: "Google Pay", emoji: "🇬", fields: { contact: "Email or phone" } },
  { id: "cash", name: "Cash (in person)", emoji: "💰", fields: {} },
  { id: "custom", name: "Custom method", emoji: "✨", fields: { username: "Method name", contact: "Instructions" } },
];

export function paymentTypeMeta(t: string) {
  return PAYMENT_TYPES.find((p) => p.id === t) ?? PAYMENT_TYPES[PAYMENT_TYPES.length - 1];
}

// ----- Host payment methods -----
export async function listMyPaymentMethods(): Promise<PaymentMethod[]> {
  const { data, error } = await supabase
    .from("host_payment_methods")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PaymentMethod[];
}

export async function listPaymentMethodsForHost(hostId: string): Promise<PaymentMethod[]> {
  const { data, error } = await supabase
    .from("host_payment_methods")
    .select("*")
    .eq("host_id", hostId)
    .eq("is_enabled", true);
  if (error) throw error;
  return (data ?? []) as PaymentMethod[];
}

export async function createPaymentMethod(input: Omit<PaymentMethod, "id" | "host_id" | "is_enabled"> & { is_enabled?: boolean }) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to add payment methods.");
  const { error } = await supabase.from("host_payment_methods").insert({
    ...input,
    host_id: u.user.id,
    is_enabled: input.is_enabled ?? true,
  });
  if (error) throw error;
}

export async function updatePaymentMethod(id: string, patch: Partial<PaymentMethod>) {
  const { error } = await supabase.from("host_payment_methods").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deletePaymentMethod(id: string) {
  const { error } = await supabase.from("host_payment_methods").delete().eq("id", id);
  if (error) throw error;
}

// ----- Game settings -----
export async function getGamePaymentSettings(gameId: string): Promise<GamePaymentSettings | null> {
  const { data, error } = await supabase
    .from("game_payment_settings")
    .select("*")
    .eq("game_id", gameId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as GamePaymentSettings) ?? null;
}

export async function getMyGamePaymentSettings(gameId: string): Promise<GamePaymentSettings | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await supabase
    .from("game_payment_settings")
    .select("*")
    .eq("game_id", gameId)
    .eq("host_id", u.user.id)
    .maybeSingle();
  if (error) throw error;
  return (data as GamePaymentSettings) ?? null;
}

export async function upsertGamePaymentSettings(input: {
  game_id: string;
  entry_fee: number;
  accepted_method_ids: string[];
  payment_deadline?: string | null;
  refund_policy?: string | null;
  payment_instructions?: string | null;
  requires_approval?: boolean;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to configure payments.");
  const { error } = await supabase
    .from("game_payment_settings")
    .upsert({ ...input, host_id: u.user.id }, { onConflict: "game_id,host_id" });
  if (error) throw error;
}

// ----- Submissions -----
export async function uploadProofScreenshot(file: File): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to upload proof.");
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${u.user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("payment-proofs").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function getSignedProofUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("payment-proofs").createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function createPaymentSubmission(input: {
  game_id: string;
  host_id: string;
  payment_method_id: string | null;
  payment_type: string | null;
  screenshot_path: string | null;
  transaction_reference?: string | null;
  notes?: string | null;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to submit proof.");
  const { error } = await supabase.from("payment_submissions").insert({
    ...input,
    player_id: u.user.id,
  });
  if (error) throw error;
}

export async function listMySubmissionsForGame(gameId: string): Promise<PaymentSubmission[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const { data, error } = await supabase
    .from("payment_submissions")
    .select("*")
    .eq("game_id", gameId)
    .eq("player_id", u.user.id)
    .order("submitted_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PaymentSubmission[];
}

export async function listHostSubmissions(status?: "pending" | "verified" | "rejected"): Promise<PaymentSubmission[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  let q = supabase
    .from("payment_submissions")
    .select("*")
    .eq("host_id", u.user.id)
    .order("submitted_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PaymentSubmission[];
}

export async function reviewSubmission(id: string, status: "verified" | "rejected" | "pending", notes?: string) {
  const { error } = await supabase
    .from("payment_submissions")
    .update({
      status,
      reviewer_notes: notes ?? null,
      reviewed_at: status === "pending" ? null : new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}
