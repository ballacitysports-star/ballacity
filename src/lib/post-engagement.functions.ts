import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export const REACTION_EMOJI = ["👍", "❤️", "🔥", "😂", "🎉", "👏"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

const SubjectType = z.enum(["team_post", "game", "highlight_reel"]);
export type EngagementSubjectType = z.infer<typeof SubjectType>;
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
  subjectType: EngagementSubjectType;
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
      .select("id, subject_type, subject_id, author_id, body, deleted_at, created_at")
      .eq("subject_type", data.subjectType)
      .eq("subject_id", data.subjectId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as any[];
    const authorIds = Array.from(new Set(list.map((r) => r.author_id).filter(Boolean)));
    const profileMap = new Map<
      string,
      { display_name: string | null; avatar_url: string | null; avatar_initials: string | null }
    >();
    if (authorIds.length > 0) {
      const { data: profs, error: pErr } = await sb
        .from("profiles" as any)
        .select("id, display_name, avatar_url, avatar_initials")
        .in("id", authorIds);
      if (pErr) throw new Error(pErr.message);
      for (const p of (profs ?? []) as any[]) {
        profileMap.set(p.id, {
          display_name: p.display_name ?? null,
          avatar_url: p.avatar_url ?? null,
          avatar_initials: p.avatar_initials ?? null,
        });
      }
    }
    return list.map((r) => {
      const p = profileMap.get(r.author_id);
      return {
        id: r.id,
        subjectType: r.subject_type,
        subjectId: r.subject_id,
        authorId: r.author_id,
        authorName: p?.display_name ?? null,
        authorAvatar: p?.avatar_url ?? null,
        authorInitials: p?.avatar_initials ?? null,
        body: r.body,
        deletedAt: r.deleted_at,
        createdAt: r.created_at,
      };
    });
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

export const updateComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), body: z.string().trim().min(1).max(1000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("post_comments" as any)
      .update({ body: data.body } as any)
      .eq("id", data.id)
      .eq("author_id", context.userId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
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
    if (error) {
      console.error("listReactions failed:", error.message);
      return [];
    }
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
  .inputValidator((input) => Subject.extend({ emoji: z.enum(REACTION_EMOJI) }).parse(input))
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
