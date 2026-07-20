import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

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

const PostKind = z.enum(["tryout", "pickup", "clinic", "announcement", "recap"]);

export const listTeamPosts = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ teamId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { data: rows, error } = await sb
      .from("team_posts" as any)
      .select("*")
      .eq("team_id", data.teamId)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as any[];
  });

const CreateInput = z.object({
  teamId: z.string().min(1),
  kind: PostKind,
  title: z.string().min(1).max(200),
  body: z.string().max(4000).default(""),
  eventDate: z.string().datetime().nullable().optional(),
  location: z.string().max(300).nullable().optional(),
  price: z.number().int().min(0).max(100000).nullable().optional(),
  spotsMax: z.number().int().min(1).max(500).nullable().optional(),
  pinned: z.boolean().optional(),
});

export const createTeamPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CreateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("team_posts" as any)
      .insert({
        team_id: data.teamId,
        author_id: context.userId,
        kind: data.kind,
        title: data.title,
        body: data.body ?? "",
        event_date: data.eventDate ?? null,
        location: data.location ?? null,
        price: data.price ?? null,
        spots_max: data.spotsMax ?? null,
        pinned: data.pinned ?? false,
      } as any)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteTeamPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("team_posts" as any)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
