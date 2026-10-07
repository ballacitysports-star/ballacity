import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ALL_EXPORT_CATEGORIES,
  EXPORT_BUCKET,
  EXPORT_SIGNED_URL_SECONDS,
  EXPORT_TTL_HOURS,
  type ExportCategory,
} from "@/lib/data-export";

export type DataExportRequestRow = {
  id: string;
  status: "requested" | "processing" | "ready" | "expired" | "failed";
  categories: string[];
  file_bytes: number | null;
  row_counts: Record<string, number>;
  error_message: string | null;
  requested_at: string;
  ready_at: string | null;
  expires_at: string | null;
};

const SELECT_COLUMNS =
  "id, status, categories, file_bytes, row_counts, error_message, requested_at, ready_at, expires_at";

/**
 * Columns copied into the export per category.
 *
 * Every read below runs through the caller's own RLS-scoped client and is
 * filtered by the caller's id, so an export can only ever contain the caller's
 * own rows. Columns that hold internal review data (reviewer identities,
 * moderation notes) or other members' content are deliberately not selected.
 */
const CATEGORY_QUERIES: Record<
  ExportCategory,
  Array<{ key: string; table: string; columns: string; column: string }>
> = {
  profile: [
    {
      key: "profile",
      table: "profiles",
      column: "id",
      columns:
        "id, username, display_name, avatar_initials, bio, sport, sport_levels, city, graduating_class, account_type, search_radius_mi, links, avatar_url, cover_url, created_at, updated_at",
    },
    {
      key: "birthday",
      table: "profile_birthdays",
      column: "user_id",
      columns: "birthday, updated_at",
    },

    {
      key: "profile_types",
      table: "account_profiles",
      column: "user_id",
      columns: "id, kind, ref_id, created_at",
    },
    {
      key: "following",
      table: "follows",
      column: "follower_id",
      columns: "followee_id, created_at",
    },
  ],
  preferences: [
    {
      key: "privacy_preferences",
      table: "privacy_preferences",
      column: "user_id",
      columns:
        "profile_visibility, location_precision, show_sports, show_games_played, allow_messages, allow_invites, marketing_emails, ai_processing, ai_training_opt_in, ai_disclosure_ack_at, updated_at",
    },
    {
      key: "notification_preferences",
      table: "notification_preferences",
      column: "user_id",
      columns: "prefs, updated_at",
    },
    {
      key: "feed_preferences",
      table: "feed_preferences",
      column: "user_id",
      columns: "prefs, saved_views, updated_at",
    },
  ],
  games_created: [
    {
      key: "games_created",
      table: "hosted_games",
      column: "host_id",
      columns:
        "id, sport, title, date, ends_at, all_day, timezone, duration, location, neighborhood, lat, lng, max_players, joined, skill, price, indoor, is_private, status, description, equipment, min_age, max_age, created_at",
    },
    {
      key: "game_payment_settings",
      table: "game_payment_settings",
      column: "host_id",
      columns:
        "game_id, entry_fee, accepted_method_ids, payment_deadline, refund_policy, requires_approval, created_at",
    },
  ],
  games_joined: [
    {
      key: "games_joined",
      table: "game_participants",
      column: "user_id",
      columns: "game_id, position, created_at",
    },
    {
      key: "join_requests",
      table: "join_requests",
      column: "player_id",
      columns: "game_id, status, message, created_at, reviewed_at",
    },
    {
      key: "position_waitlist",
      table: "game_position_waitlist",
      column: "user_id",
      columns: "game_id, position, status, created_at",
    },
    {
      key: "game_reminders",
      table: "game_reminders",
      column: "user_id",
      columns: "game_id, offsets, created_at",
    },
  ],
  availability: [
    {
      key: "availability",
      table: "player_availabilities",
      column: "user_id",
      columns:
        "id, sports, skill_level, starts_on, ends_on, recurring_days, time_slots, timezone, city, formatted_address, travel_radius_km, note, status, created_at",
    },
  ],
  reviews: [
    {
      key: "reviews",
      table: "reviews",
      column: "reviewer_id",
      columns:
        "id, kind, reviewee_kind, reviewee_name, rating, scores, title, body, context, verified, is_private, created_at",
    },
  ],
  media_metadata: [
    {
      key: "highlight_media",
      table: "highlight_reels",
      column: "user_id",
      columns:
        "id, title, video_path, playback_path, thumbnail_path, audio_path, frame_paths, status, environment, game_id, game_title, hidden_at, created_at, completed_at",
    },
  ],
  ai_analysis: [
    {
      key: "ai_analysis",
      table: "highlight_reels",
      column: "user_id",
      columns:
        "id, title, ai_title, ai_caption, ai_hashtags, ai_sport, ai_analysis, ai_moments, ai_overlays, ai_timeline, ai_coaching, ai_advanced_analytics, ai_transcript, style_prefs, created_at",
    },
  ],
  safety: [
    {
      key: "blocked_accounts",
      table: "user_blocks",
      column: "blocker_id",
      columns: "blocked_id, created_at",
    },
    {
      key: "reports_you_filed",
      table: "user_reports",
      column: "reporter_id",
      columns: "id, subject_type, reason, details, status, created_at",
    },
    {
      key: "safety_acknowledgments",
      table: "game_safety_acknowledgments",
      column: "user_id",
      columns: "game_id, kind, version, accepted_at",
    },
  ],
  legal_consents: [
    {
      key: "legal_consents",
      table: "legal_consents",
      column: "user_id",
      columns: "document_type, document_version, accepted_at",
    },
  ],
  payments: [
    {
      key: "payment_submissions",
      table: "payment_submissions",
      column: "player_id",
      columns:
        "id, game_id, payment_type, transaction_reference, notes, status, paid_amount, paid_at, submitted_at, reviewed_at, disputed_at, cancelled_at",
    },
    {
      key: "subscriptions",
      table: "subscriptions",
      column: "user_id",
      columns:
        "product_id, price_id, status, current_period_start, current_period_end, cancel_at_period_end, environment, created_at",
    },
    {
      key: "purchases",
      table: "purchases",
      column: "user_id",
      columns:
        "product_id, price_id, amount_total, currency, quantity, status, environment, created_at",
    },
  ],
};

/** The signed-in member's export history, newest first. */
export const listMyDataExports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DataExportRequestRow[]> => {
    const { data, error } = await context.supabase
      .from("data_export_requests")
      .select(SELECT_COLUMNS)
      .eq("user_id", context.userId)
      .order("requested_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as DataExportRequestRow[];
  });

/**
 * Create an export request, build the file, and store it in the private
 * exports bucket. The row moves requested → processing → ready | failed.
 */
export const requestDataExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        categories: z
          .array(z.enum(ALL_EXPORT_CATEGORIES as [ExportCategory, ...ExportCategory[]]))
          .min(1)
          .optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const categories = (data.categories ?? ALL_EXPORT_CATEGORIES) as ExportCategory[];

    // The insert goes through the member's own client so RLS (and the daily
    // rate-limit trigger) apply to the request itself.
    const { data: created, error: insErr } = await context.supabase
      .from("data_export_requests")
      .insert({ user_id: userId, categories } as never)
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);
    const requestId = (created as { id: string }).id;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("data_export_requests")
      .update({ status: "processing", started_at: new Date().toISOString() } as never)
      .eq("id", requestId);

    try {
      const payload: Record<string, unknown> = {
        export_format: "openrun-data-export/v1",
        generated_at: new Date().toISOString(),
        account_id: userId,
        categories,
        notice:
          "This file contains only your own data. Passwords, authentication secrets, other members' private information and internal admin data are never included.",
      };
      const rowCounts: Record<string, number> = {};

      for (const category of categories) {
        for (const q of CATEGORY_QUERIES[category]) {
          const { data: rows, error } = await context.supabase
            .from(q.table as never)
            .select(q.columns)
            .eq(q.column, userId);
          if (error) throw new Error(`${q.key}: ${error.message}`);
          const list = (rows ?? []) as unknown[];
          payload[q.key] = list;
          rowCounts[q.key] = list.length;
        }
      }
      payload["row_counts"] = rowCounts;

      const body = JSON.stringify(payload, null, 2);
      const bytes = new TextEncoder().encode(body);
      const path = `${userId}/${requestId}.json`;

      const { error: upErr } = await supabaseAdmin.storage
        .from(EXPORT_BUCKET)
        .upload(path, bytes, { contentType: "application/json", upsert: true });
      if (upErr) throw new Error(upErr.message);

      const readyAt = new Date();
      const expiresAt = new Date(readyAt.getTime() + EXPORT_TTL_HOURS * 3600 * 1000);
      await supabaseAdmin
        .from("data_export_requests")
        .update({
          status: "ready",
          storage_path: path,
          file_bytes: bytes.byteLength,
          row_counts: rowCounts,
          ready_at: readyAt.toISOString(),
          expires_at: expiresAt.toISOString(),
        } as never)
        .eq("id", requestId);

      await supabaseAdmin.from("notifications").insert({
        user_id: userId,
        type: "data_export_ready",
        title: "Your data export is ready",
        body: `Download it within ${EXPORT_TTL_HOURS} hours.`,
        link: "/account/data",
      } as never);

      return { id: requestId, status: "ready" as const };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Export failed";
      await supabaseAdmin
        .from("data_export_requests")
        .update({ status: "failed", error_message: message.slice(0, 500) } as never)
        .eq("id", requestId);
      await supabaseAdmin.from("notifications").insert({
        user_id: userId,
        type: "data_export_failed",
        title: "Your data export could not be built",
        body: "Please try requesting it again.",
        link: "/account/data",
      } as never);
      return { id: requestId, status: "failed" as const, error: message };
    }
  });

/**
 * Mint a short-lived signed download URL. Ownership is re-checked server-side
 * and the file is never exposed through a public URL.
 */
export const getDataExportDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("data_export_requests")
      .select("id, user_id, status, storage_path, expires_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const request = row as {
      user_id: string;
      status: string;
      storage_path: string | null;
      expires_at: string | null;
    } | null;
    if (!request || request.user_id !== context.userId) throw new Error("Export not found");
    if (request.status !== "ready" || !request.storage_path)
      throw new Error("This export is not available for download");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (request.expires_at && new Date(request.expires_at).getTime() <= Date.now()) {
      await supabaseAdmin
        .from("data_export_requests")
        .update({ status: "expired" } as never)
        .eq("id", data.id);
      throw new Error("This export has expired. Request a new one.");
    }

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(EXPORT_BUCKET)
      .createSignedUrl(request.storage_path, EXPORT_SIGNED_URL_SECONDS);
    if (signErr || !signed?.signedUrl) throw new Error(signErr?.message ?? "Could not sign URL");
    return { url: signed.signedUrl, expiresInSeconds: EXPORT_SIGNED_URL_SECONDS };
  });
