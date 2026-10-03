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

export const listRecentTeamPosts = createServerFn({ method: "GET" })
  .inputValidator((input) =>
    z
      .object({
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).max(1000).optional(),
        sport: z.string().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const sb = publicClient();
    const limit = data.limit ?? 10;
    const offset = data.offset ?? 0;
    let query = sb
      .from("team_posts" as any)
      .select("*, teams!inner(id, name, sports, kind, avatar)")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (data.sport) {
      query = query.contains("teams.sports", [data.sport]);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return ((rows ?? []) as any[]).map((r) => ({
      id: r.id as string,
      teamId: r.team_id as string,
      teamName: (r.teams?.name ?? "Team") as string,
      teamSports: (r.teams?.sports ?? []) as string[],
      teamKind: (r.teams?.kind ?? "team") as string,
      teamAvatar: (r.teams?.avatar ?? null) as string | null,
      kind: r.kind as string,
      title: r.title as string,
      body: (r.body ?? "") as string,
      eventDate: (r.event_date ?? null) as string | null,
      location: (r.location ?? null) as string | null,
      placeId: (r.place_id ?? null) as string | null,
      formattedAddress: (r.formatted_address ?? null) as string | null,
      lat: (r.lat ?? null) as number | null,
      lng: (r.lng ?? null) as number | null,
      price: (r.price ?? null) as number | null,
      spotsMax: (r.spots_max ?? null) as number | null,
      pinned: !!r.pinned,
      createdAt: r.created_at as string,
    }));
  });

const CreateInput = z.object({
  teamId: z.string().min(1),
  kind: PostKind,
  title: z.string().min(1).max(200),
  body: z.string().max(4000).default(""),
  eventDate: z.string().datetime().nullable().optional(),
  location: z.string().max(300).nullable().optional(),
  placeId: z.string().max(300).nullable().optional(),
  formattedAddress: z.string().max(500).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
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
        place_id: data.placeId ?? null,
        formatted_address: data.formattedAddress ?? null,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
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

export const updateTeamPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        kind: z.enum(["tryout", "clinic"]),
        title: z.string().trim().min(1).max(120),
        body: z.string().max(4000).optional(),
        eventDate: z.string().datetime().nullable(),
        location: z.string().max(200).nullable(),
        price: z.number().int().min(0).max(100000).nullable(),
        spotsMax: z.number().int().min(1).max(500).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("team_posts")
      .update({
        kind: data.kind,
        title: data.title,
        body: data.body ?? "",
        event_date: data.eventDate,
        location: data.location,
        price: data.price,
        spots_max: data.spotsMax,
      })
      .eq("id", data.id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("You can't edit this post.");
    return { ok: true };
  });
