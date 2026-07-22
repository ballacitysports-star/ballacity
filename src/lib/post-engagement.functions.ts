import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export const REACTION_EMOJI = ["👍", "❤️", "🔥", "😂", "🎉", "👏"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

const SubjectType = z.enum(["team_post", "game"]);
const Subject = z.object({
  subjectType: SubjectType,
  subjectId: z.string().min(1).max(200),
});

function publicClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export type CommentRow = {
  id: string;
  subjectType: "team_post" | "game";
  subjectId: string;
  authorId: string;
  authorName: string | null;
  authorAvatar: string | null;
  authorInitials: string | null;
  body: string;
  deletedAt: string | null;
  createdAt: string;
};

export const listComments = createServerFn({ method: "GET" })
  .inputValidator((input) => Subject.parse(input))
  .handler(async ({ data }): Promise<CommentRow[]> => {
    const sb = publicClient();
    const { data: rows, error } = await sb
      .from("post_comments" as any)
      .select("*, profiles:author_id(display_name, avatar_url, avatar_initials)")
      .eq("subject_type", data.subjectType)
      .eq("subject_id", data.subjectId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return ((rows ?? []) as any[]).map((r) => ({
      id: r.id,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      authorId: r.author_id,
      authorName: r.profiles?.display_name ?? null,
      authorAvatar: r.profiles?.avatar_url ?? null,
      authorInitials: r.profiles?.avatar_initials ?? null,
      body: r.body,
      deletedAt: r.deleted_at,
      createdAt: r.created_at,
    }));
  });

export const createComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    Subject.extend({ body: z.string().trim().min(1).max(1000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("post_comments" as any)
      .insert({
        subject_type: data.subjectType,
        subject_id: data.subjectId,
        author_id: context.userId,
        body: data.body,
      } as any)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("post_comments" as any)
      .update({ body: "[deleted]", deleted_at: new Date().toISOString() } as any)
      .eq("id", data.id)
      .eq("author_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type ReactionSummary = {
  emoji: ReactionEmoji;
  count: number;
  mine: boolean;
};

export const listReactions = createServerFn({ method: "GET" })
  .inputValidator((input) => Subject.parse(input))
  .handler(async ({ data }): Promise<ReactionSummary[]> => {
    const sb = publicClient();
    const { data: rows, error } = await sb
      .from("post_reactions" as any)
      .select("emoji, user_id")
      .eq("subject_type", data.subjectType)
      .eq("subject_id", data.subjectId);
    if (error) throw new Error(error.message);
    const counts = new Map<ReactionEmoji, number>();
    for (const r of (rows ?? []) as any[]) {
      const e = r.emoji as ReactionEmoji;
      counts.set(e, (counts.get(e) ?? 0) + 1);
    }
    return REACTION_EMOJI.map((e) => ({
      emoji: e,
      count: counts.get(e) ?? 0,
      mine: false,
    })).filter((r) => r.count > 0);
  });

export const listMyReactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => Subject.parse(input))
  .handler(async ({ data, context }): Promise<ReactionEmoji[]> => {
    const { data: rows, error } = await context.supabase
      .from("post_reactions" as any)
      .select("emoji")
      .eq("subject_type", data.subjectType)
      .eq("subject_id", data.subjectId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return ((rows ?? []) as any[]).map((r) => r.emoji as ReactionEmoji);
  });

export const toggleReaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    Subject.extend({ emoji: z.enum(REACTION_EMOJI) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("post_reactions" as any)
      .select("id")
      .eq("subject_type", data.subjectType)
      .eq("subject_id", data.subjectId)
      .eq("user_id", context.userId)
      .eq("emoji", data.emoji)
      .maybeSingle();
    const existingId = (existing as { id?: string } | null)?.id;
    if (existingId) {
      const { error } = await context.supabase
        .from("post_reactions" as any)
        .delete()
        .eq("id", existingId);
      if (error) throw new Error(error.message);
      return { active: false };
    }
    const { error } = await context.supabase.from("post_reactions" as any).insert({
      subject_type: data.subjectType,
      subject_id: data.subjectId,
      user_id: context.userId,
      emoji: data.emoji,
    } as any);
    if (error) throw new Error(error.message);
    return { active: true };
  });
