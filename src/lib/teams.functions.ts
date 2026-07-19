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

const TeamInput = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(["team", "coach"]),
  name: z.string().min(1).max(120),
  handle: z.string().min(1).max(60),
  tagline: z.string().max(200).default(""),
  city: z.string().max(200).default(""),
  founded: z.number().int().nullable().optional(),
  sports: z.array(z.string()).default([]),
  bio: z.string().max(4000).default(""),
  achievements: z.array(z.string()).default([]),
  accent: z.string().max(20).default("#a3ff12"),
  avatar: z.string().max(10).default(""),
  cover: z.string().max(2000).default(""),
  league: z.string().max(200).nullable().optional(),
  home_court: z.string().max(200).nullable().optional(),
  wins: z.number().int().min(0).default(0),
  losses: z.number().int().min(0).default(0),
  staff: z
    .array(z.object({ name: z.string(), role: z.string(), avatar: z.string() }))
    .default([]),
  credentials: z.array(z.string()).default([]),
  rate_per_hour: z.number().int().nullable().optional(),
  skill_min: z.number().int().min(1).max(5).default(1),
  skill_max: z.number().int().min(1).max(5).default(5),
  format: z.string().max(120).nullable().optional(),
  formats: z.array(z.string().max(120)).default([]),
  venues: z.array(z.string().max(60)).default([]),
  venue_addresses: z.array(z.string().max(300)).default([]),
  cadence: z.string().max(60).nullable().optional(),
  cadences: z.array(z.string().max(60)).default([]),
  positions_needed: z.record(z.string(), z.record(z.string(), z.number().int().min(0).max(30))).default({}),
  rating_system: z.enum(["NTRP", "DUPR", "UTR", "PACE", "SELF"]).nullable().optional(),
  rating_min: z.string().max(20).nullable().optional(),
  rating_max: z.string().max(20).nullable().optional(),
  distances: z.array(z.string().max(40)).default([]),
  session_types: z.array(z.string().max(40)).default([]),
  availability_slots: z
    .array(
      z.object({
        day: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
        start: z.string().regex(/^\d{2}:\d{2}$/),
        end: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .default([]),
});

const TeamPatch = TeamInput.partial().extend({ id: z.string() });

export const listTeams = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const { data, error } = await sb
    .from("teams")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const getTeamById = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { data: row, error } = await sb
      .from("teams")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const createTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => TeamInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("teams")
      .insert({ ...data, owner_id: context.userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => TeamPatch.parse(input))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { data: row, error } = await context.supabase
      .from("teams")
      .update(patch)
      .eq("id", id)
      .eq("owner_id", context.userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("teams")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
