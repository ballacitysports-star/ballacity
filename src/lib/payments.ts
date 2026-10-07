import { supabase } from "@/integrations/supabase/client";
import { validateImageMeta } from "@/lib/image-validation";
import type { CancellationReason, PaymentSubmissionStatus } from "@/lib/payment-states";
import type { PaymentMode } from "@/lib/monetization/fees";
import { PAYMENTS_BLOCKED_MESSAGE } from "@/lib/payments-policy";

export type PaymentType =
  "venmo" | "cashapp" | "zelle" | "paypal" | "applecash" | "googlepay" | "cash" | "custom";

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
  /** `direct_host` today; `ballacity_processed` is reserved for a future processor. */
  payment_mode?: PaymentMode;
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
  attempt_count?: number;
  last_rejected_at?: string | null;
};

export const JOIN_RESUBMIT_COOLDOWN_MS = 15 * 60 * 1000;
export const JOIN_RESUBMIT_MAX_ATTEMPTS = 3;

/**
 * Milliseconds remaining before the caller may resubmit after a rejection.
 * 0 means no active cooldown. Client-side gate that mirrors the DB trigger
 * so the UI can disable the CTA and show a countdown before the network round-trip.
 */
export function joinResubmitCooldownRemainingMs(req: JoinRequest | null): number {
  if (!req || req.status !== "rejected" || !req.last_rejected_at) return 0;
  const until = new Date(req.last_rejected_at).getTime() + JOIN_RESUBMIT_COOLDOWN_MS;
  return Math.max(0, until - Date.now());
}

export function joinResubmitCapReached(req: JoinRequest | null): boolean {
  if (!req || req.status !== "rejected") return false;
  return (req.attempt_count ?? 1) >= JOIN_RESUBMIT_MAX_ATTEMPTS;
}

export type PaymentSubmission = {
  id: string;
  player_id: string;
  game_id: string;
  host_id: string;
  payment_method_id: string | null;
  payment_type: string | null;
  screenshot_path: string | null;
  transaction_reference: string | null;
  paid_amount: number | null;
  paid_at: string | null;
  notes: string | null;
  status: PaymentSubmissionStatus;
  reviewer_notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  dispute_reason?: string | null;
  disputed_at?: string | null;
  disputed_by?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
};

export const PAYMENT_TYPES: {
  id: PaymentType;
  name: string;
  emoji: string;
  fields: { username?: string; url?: string; contact?: string };
}[] = [
  {
    id: "venmo",
    name: "Venmo",
    emoji: "💸",
    fields: { username: "Venmo username", url: "Payment link (venmo.com/u/…)" },
  },
  {
    id: "cashapp",
    name: "Cash App",
    emoji: "💵",
    fields: { username: "Cashtag ($yourname)", url: "Payment link (cash.app/$…)" },
  },
  { id: "zelle", name: "Zelle", emoji: "⚡", fields: { contact: "Email or phone" } },
  {
    id: "paypal",
    name: "PayPal F&F",
    emoji: "🅿️",
    fields: { username: "PayPal username", url: "PayPal.me link" },
  },
  { id: "applecash", name: "Apple Cash", emoji: "🍎", fields: { contact: "Phone number" } },
  { id: "googlepay", name: "Google Pay", emoji: "🇬", fields: { contact: "Email or phone" } },
  { id: "cash", name: "Cash (in person)", emoji: "💰", fields: {} },
  {
    id: "custom",
    name: "Custom method",
    emoji: "✨",
    fields: { username: "Method name", contact: "Instructions" },
  },
];

export function paymentTypeMeta(t: string) {
  return PAYMENT_TYPES.find((p) => p.id === t) ?? PAYMENT_TYPES[PAYMENT_TYPES.length - 1];
}

/**
 * Builds a 1-tap pay link with the host, amount and game title pre-filled
 * where the provider supports it. Falls back to the host's saved link.
 * `copyText` is the handle/contact copied to the clipboard on launch.
 */
export function resolvePaymentDeepLink(
  method: Pick<PaymentMethod, "payment_type" | "username" | "payment_url" | "contact_info">,
  fee: number | null | undefined,
  gameTitle: string,
): { url: string | null; copyText: string | null } {
  const amount = fee && fee > 0 ? (Math.round(fee * 100) / 100).toString() : "";
  const handle = (method.username ?? "").trim().replace(/^[@$]/, "");
  const safe = /^[A-Za-z0-9._-]{1,60}$/.test(handle) ? handle : "";
  const note = encodeURIComponent(`BallaCity: ${gameTitle}`.slice(0, 120));
  const copyText = method.username?.trim() || method.contact_info?.trim() || null;
  switch (method.payment_type) {
    case "venmo":
      if (safe)
        return {
          url: `https://venmo.com/?txn=pay&recipients=${encodeURIComponent(safe)}${amount ? `&amount=${amount}` : ""}&note=${note}`,
          copyText,
        };
      break;
    case "cashapp":
      if (safe)
        return {
          url: `https://cash.app/$${encodeURIComponent(safe)}${amount ? `/${amount}` : ""}`,
          copyText,
        };
      break;
    case "paypal":
      if (safe)
        return {
          url: `https://paypal.me/${encodeURIComponent(safe)}${amount ? `/${amount}USD` : ""}`,
          copyText,
        };
      break;
  }
  return { url: method.payment_url ?? null, copyText };
}

// ----- Host payment methods -----
export async function listMyPaymentMethods(): Promise<PaymentMethod[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const { data, error } = await supabase
    .from("host_payment_methods")
    .select("*")
    .eq("host_id", u.user.id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PaymentMethod[];
}

export async function listPaymentMethodsForHost(
  hostId: string,
  gameId?: string,
): Promise<PaymentMethod[]> {
  const { data, error } = gameId
    ? await supabase.rpc("get_game_host_payment_methods", { _host_id: hostId, _game_id: gameId })
    : await supabase.rpc("get_host_payment_methods", { _host_id: hostId });
  if (error) throw error;
  return (data ?? []) as PaymentMethod[];
}

export async function createPaymentMethod(
  input: Omit<PaymentMethod, "id" | "host_id" | "is_enabled"> & { is_enabled?: boolean },
) {
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

// ----- Host PayPal checkout connection -----
export type HostPayPalAccount = {
  host_id: string;
  merchant_id: string;
  email: string | null;
  connected_at: string;
};

export async function getMyPayPalAccount(): Promise<HostPayPalAccount | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await supabase
    .from("host_paypal_accounts")
    .select("*")
    .eq("host_id", u.user.id)
    .maybeSingle();
  if (error) throw error;
  return (data as HostPayPalAccount) ?? null;
}

export async function saveMyPayPalAccount(merchantId: string, email?: string | null) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to connect PayPal.");
  const clean = merchantId.trim();
  if (!/^[A-Za-z0-9]{3,64}$/.test(clean)) {
    throw new Error("Enter your PayPal Merchant ID (13 letters/numbers, from your PayPal business settings).");
  }
  const { error } = await supabase.from("host_paypal_accounts").upsert({
    host_id: u.user.id,
    merchant_id: clean,
    email: email?.trim() || null,
  });
  if (error) throw error;
}

export async function disconnectMyPayPalAccount() {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  const { error } = await supabase.from("host_paypal_accounts").delete().eq("host_id", u.user.id);
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

export async function getMyGamePaymentSettings(
  gameId: string,
): Promise<GamePaymentSettings | null> {
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
  /**
   * Only `direct_host` is live: the player pays the host in their own payment
   * app. `ballacity_processed` exists so a future processor slots in without a
   * schema redesign, and the database rejects it until one is wired.
   */
  payment_mode?: PaymentMode;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to configure payments.");
  const payment_mode = input.payment_mode ?? "direct_host";
  if (payment_mode !== "direct_host") {
    throw new Error("ballaCity does not process game payments yet — hosts collect directly.");
  }
  const { error } = await supabase
    .from("game_payment_settings")
    .upsert({ ...input, payment_mode, host_id: u.user.id }, { onConflict: "game_id,host_id" });
  if (error) throw error;
}

// ----- Submissions -----
export async function uploadProofScreenshot(file: File): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to upload proof.");
  // Proof screenshots are images only — reject anything else before it lands in
  // storage, and pin the stored content type so it can never be served as HTML.
  const invalid = validateImageMeta({ mime: file.type, bytes: file.size });
  if (invalid) throw new Error(invalid);
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${u.user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("payment-proofs").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });
  if (error) throw error;
  return path;
}

export async function getSignedProofUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("payment-proofs")
    .createSignedUrl(path, 60 * 10);
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
  paid_amount?: number | null;
  paid_at?: string | null;
  notes?: string | null;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to submit proof.");
  // Age gate (see PERMISSION_MATRIX.game_payments). Enforced again by the
  // `enforce_game_payment_cohort` database trigger.
  const { data: allowed } = await (supabase.rpc as any)("game_payments_allowed", {
    _user: u.user.id,
  });
  if (allowed === false) throw new Error(PAYMENTS_BLOCKED_MESSAGE);
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

export async function listHostSubmissions(
  status?: PaymentSubmissionStatus,
): Promise<PaymentSubmission[]> {
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

export async function reviewSubmission(
  id: string,
  status: "verified" | "rejected" | "pending",
  notes?: string,
) {
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

/**
 * Player-side cancel. A player may only ever move their own claim to
 * `cancelled` — the database guard blocks any attempt to self-confirm.
 */
export async function cancelMyPaymentSubmission(
  id: string,
  reason: CancellationReason = "player_cancelled",
  notes?: string,
) {
  const { error } = await supabase
    .from("payment_submissions")
    .update({
      status: "cancelled",
      cancellation_reason: reason,
      cancelled_at: new Date().toISOString(),
      notes: notes?.trim().slice(0, 500) ?? undefined,
    } as never)
    .eq("id", id);
  if (error) throw error;
}

/** Either party can flag a payment as disputed; ballaCity never moves money. */
export async function disputeMyPaymentSubmission(id: string, reason: string) {
  const trimmed = reason.trim().slice(0, 500);
  if (!trimmed) throw new Error("Tell us what went wrong with this payment.");
  const { error } = await supabase
    .from("payment_submissions")
    .update({
      status: "disputed",
      dispute_reason: trimmed,
      disputed_at: new Date().toISOString(),
    } as never)
    .eq("id", id);
  if (error) throw error;
}

/** Host-side cancel, e.g. the game itself is off. */
export async function hostCancelPaymentSubmission(
  id: string,
  reason: CancellationReason,
  notes?: string,
) {
  const { error } = await supabase
    .from("payment_submissions")
    .update({
      status: "cancelled",
      cancellation_reason: reason,
      cancelled_at: new Date().toISOString(),
      reviewer_notes: notes?.trim().slice(0, 500) ?? null,
    } as never)
    .eq("id", id);
  if (error) throw error;
}

// ----- Withdraw submission -----
export async function deleteMyPendingSubmission(id: string) {
  const { error } = await supabase.from("payment_submissions").delete().eq("id", id);
  if (error) throw error;
}

// ----- Join requests -----
/**
 * Create a join request idempotently.
 *
 * `idempotency_key` is unique per player. Re-submitting with the same key
 * (rapid double-tap, retry after a network blip, a second tab) resolves to
 * the row created by the first request instead of a duplicate. The default
 * key is stable per (game_id, player_id) so any accidental re-submission
 * for the same game deduplicates server-side, even across tabs/devices.
 */
export async function createJoinRequest(input: {
  game_id: string;
  host_id: string;
  message?: string | null;
  idempotency_key?: string;
}): Promise<JoinRequest> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to request to join.");

  const idempotency_key = input.idempotency_key ?? `join:${input.game_id}`;

  const attemptInsert = async () =>
    supabase
      .from("join_requests")
      .insert({
        game_id: input.game_id,
        host_id: input.host_id,
        player_id: u.user!.id,
        message: input.message ?? null,
        idempotency_key,
      })
      .select("*")
      .single();

  const { data, error } = await attemptInsert();
  if (!error && data) return data as JoinRequest;

  // 23505 = unique_violation. Either (player_id, idempotency_key) or the
  // (game_id, player_id) constraint fired. If the existing row is 'rejected',
  // the host previously declined — flip it back to pending (UPDATE) so the
  // resubmit trigger can enforce the 15-minute cooldown and 3-attempt cap
  // against the prior row's `attempt_count` / `last_rejected_at`.
  // Otherwise (pending/approved) return the existing row so callers see a
  // successful idempotent result.
  if (error && (error as { code?: string }).code === "23505") {
    const { data: existing, error: readErr } = await supabase
      .from("join_requests")
      .select("*")
      .eq("player_id", u.user.id)
      .or(`idempotency_key.eq.${idempotency_key},and(game_id.eq.${input.game_id})`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (readErr) throw readErr;
    if (existing) {
      const prev = existing as JoinRequest;
      if (prev.status === "rejected") {
        // Pre-check on client so we can raise a friendly message before the
        // DB trigger fires. The trigger is still the source of truth.
        if (joinResubmitCapReached(prev)) {
          throw new Error(
            `You've reached the maximum of ${JOIN_RESUBMIT_MAX_ATTEMPTS} resubmit attempts for this game. Message the host instead.`,
          );
        }
        const cooldownMs = joinResubmitCooldownRemainingMs(prev);
        if (cooldownMs > 0) {
          const secs = Math.ceil(cooldownMs / 1000);
          throw new Error(`Please wait ${formatCooldown(secs)} before resubmitting this request.`);
        }
        const { data: retryData, error: retryErr } = await supabase
          .from("join_requests")
          .update({
            status: "pending",
            message: input.message ?? null,
            // reviewer_notes / reviewed_at are cleared by the trigger.
          } as never)
          .eq("id", prev.id)
          .eq("status", "rejected")
          .select("*")
          .single();
        if (retryErr) {
          // Trigger raises P0001 with a human-readable message for cap/cooldown.
          throw new Error(retryErr.message);
        }
        return retryData as JoinRequest;
      }
      return prev;
    }
  }

  throw error;
}

function formatCooldown(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export async function cancelMyJoinRequest(gameId: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  const { error } = await supabase
    .from("join_requests")
    .delete()
    .eq("game_id", gameId)
    .eq("player_id", u.user.id)
    .eq("status", "pending");
  if (error) throw error;
}

/**
 * Release the caller's approved join request for a game. Used when a
 * confirmed player taps "Leave" — without this the approval gate stays
 * cleared and the roster refetch flips them right back to Confirmed.
 * RLS scopes deletes to `player_id = auth.uid()`.
 */
export async function withdrawMyApprovedJoinRequest(gameId: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  const { error } = await supabase
    .from("join_requests")
    .delete()
    .eq("game_id", gameId)
    .eq("player_id", u.user.id)
    .eq("status", "approved");
  if (error) throw error;
}

/**
 * Host-side removal of a player from a game. Deletes the participant row,
 * any lingering join_request row (which is what causes the roster to keep
 * rendering a "ghost" approved player when only game_participants is
 * cleaned up), and any pending/verified payment submission for that player
 * on this game so payment chips don't linger. RLS restricts each delete
 * to the game's host.
 */
export async function hostRemoveParticipant(params: {
  gameId: string;
  playerId: string;
}): Promise<void> {
  const { gameId, playerId } = params;
  const { error: partErr } = await supabase
    .from("game_participants")
    .delete()
    .eq("game_id", gameId)
    .eq("user_id", playerId);
  if (partErr) throw partErr;
  // Best-effort: strip request + payment residue so the row disappears
  // everywhere. Failures here shouldn't roll back the removal.
  await supabase
    .from("join_requests")
    .delete()
    .eq("game_id", gameId)
    .eq("player_id", playerId)
    .then(
      () => undefined,
      () => undefined,
    );
  await supabase
    .from("payment_submissions")
    .delete()
    .eq("game_id", gameId)
    .eq("player_id", playerId)
    .then(
      () => undefined,
      () => undefined,
    );
}

export async function getMyJoinRequest(gameId: string): Promise<JoinRequest | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await supabase
    .from("join_requests")
    .select("*")
    .eq("game_id", gameId)
    .eq("player_id", u.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as JoinRequest) ?? null;
}

export async function listHostJoinRequests(
  status?: "pending" | "approved" | "rejected",
): Promise<JoinRequest[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  let q = supabase
    .from("join_requests")
    .select("*")
    .eq("host_id", u.user.id)
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as JoinRequest[];
}

export async function listMyJoinRequests(
  status?: "pending" | "approved" | "rejected",
): Promise<JoinRequest[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  let q = supabase
    .from("join_requests")
    .select("*")
    .eq("player_id", u.user.id)
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as JoinRequest[];
}

export async function reviewJoinRequest(
  id: string,
  status: "approved" | "rejected",
  notes?: string,
) {
  const { error } = await supabase
    .from("join_requests")
    .update({
      status,
      reviewer_notes: notes ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}
