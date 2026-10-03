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
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export type TryoutListing = {
  id: string;
  kind: "tryout" | "clinic";
  title: string;
  body: string;
  eventDate: string | null;
  location: string | null;
  price: number | null;
  spotsMax: number | null;
  spotsTaken: number;
  teamId: string;
  teamName: string;
  teamAvatar: string | null;
  sports: string[];
};

/** Public: upcoming tryouts and camps across all visible teams. */
export const listUpcomingTryouts = createServerFn({ method: "GET" }).handler(
  async (): Promise<TryoutListing[]> => {
    const { data, error } = await publicClient()
      .from("team_posts")
      .select("id,kind,title,body,event_date,location,price,spots_max,spots_taken,team_id,teams!inner(name,avatar,sports)")
      .in("kind", ["tryout", "clinic"])
      .is("hidden_at", null)
      .gte("event_date", new Date().toISOString())
      .order("event_date", { ascending: true })
      .limit(12);
    if (error) {
      console.error("listUpcomingTryouts", error.message);
      return [];
    }
    return (data ?? []).map((r: any) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body ?? "",
      eventDate: r.event_date,
      location: r.location,
      price: r.price,
      spotsMax: r.spots_max,
      spotsTaken: r.spots_taken ?? 0,
      teamId: r.team_id,
      teamName: r.teams?.name ?? "Team",
      teamAvatar: r.teams?.avatar ?? null,
      sports: r.teams?.sports ?? [],
    }));
  },
);

/** Signed-in: waiver (if any), my RSVPs, my linked children. */
export const getTryoutRsvpContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ postId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const [w, kids] = await Promise.all([
      sb.rpc("get_tryout_waiver", { _post_id: data.postId }),
      sb.rpc("guardian_children_overview"),
    ]);
    const children = ((kids.data ?? []) as any[]).map((k) => ({
      id: k.child_user_id as string,
      name: (k.display_name as string | null) ?? "Child",
    }));
    const ids = [context.userId, ...children.map((c) => c.id)];
    const [rs, sigs] = await Promise.all([
      sb.from("tryout_rsvps").select("user_id,status").eq("post_id", data.postId).in("user_id", ids),
      (w.data as any[])?.[0]
        ? sb.from("team_waiver_signatures").select("signer_user_id").eq("waiver_id", (w.data as any[])[0].id).in("signer_user_id", ids)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    return {
      waiver: ((w.data as any[]) ?? [])[0] ?? null as null | { id: string; title: string; version: string; content: string },
      children,
      registered: (rs.data ?? []).filter((r) => r.status === "registered").map((r) => r.user_id),
      signed: ((sigs as any).data ?? []).map((s: any) => s.signer_user_id as string),
    };
  });

const ERRORS: Record<string, string> = {
  TRYOUT_FULL: "This event is full.",
  ALREADY_REGISTERED: "Already registered.",
  WAIVER_REQUIRED: "Please read and accept the waiver first.",
  TRYOUT_PASSED: "This event has already happened.",
  NOT_YOUR_GUARDIAN_LINK: "You can only register your own linked children.",
  TRYOUT_NOT_FOUND: "This event is no longer available.",
};
const friendly = (m: string) => ERRORS[Object.keys(ERRORS).find((k) => m.includes(k)) ?? ""] ?? "Something went wrong. Please try again.";

export const rsvpTryout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      postId: z.string().uuid(),
      onBehalfOf: z.string().uuid().nullable(),
      waiverId: z.string().uuid().nullable(),
      attested: z.boolean(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("rsvp_tryout", {
      _post_id: data.postId,
      _on_behalf_of: data.onBehalfOf as any,
      _waiver_id: data.waiverId as any,
      _attested: data.attested,
    });
    if (error) return { ok: false as const, error: friendly(error.message) };
    return { ok: true as const };
  });

export const cancelTryoutRsvp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ postId: z.string().uuid(), onBehalfOf: z.string().uuid().nullable() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("cancel_tryout_rsvp", {
      _post_id: data.postId,
      _on_behalf_of: data.onBehalfOf as any,
    });
    if (error) return { ok: false as const, error: friendly(error.message) };
    return { ok: true as const };
  });

/** Teams the caller can post tryouts for. */
export const listMyManagedTeams = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("team_members")
      .select("team_id, role, teams!inner(name)")
      .eq("user_id", context.userId)
      .in("role", ["owner", "manager", "coach"]);
    return (data ?? []).map((r: any) => ({ id: r.team_id as string, name: r.teams?.name as string }));
  });
