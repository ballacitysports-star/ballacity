import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { bookingHref } from "@/lib/org-listing";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Everything the game page's venue card needs about a facility, plus how many
 * *other* public runs are on there in the next 7 days. Public data only (the
 * columns anonymous visitors can already read on the gym page).
 */
export function useFacilityHub(orgId: string | null | undefined, gameId?: string) {
  return useQuery({
    queryKey: ["facility-hub", orgId, gameId ?? null],
    enabled: !!orgId,
    staleTime: 60_000,
    queryFn: async () => {
      const now = Date.now();
      let runs = supabase
        .from("hosted_games")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId!)
        .eq("is_private", false)
        .is("hidden_at", null)
        .is("org_hidden_at", null)
        .is("cancelled_at", null)
        .gte("date", new Date(now).toISOString())
        .lt("date", new Date(now + WEEK_MS).toISOString());
      if (gameId) runs = runs.neq("id", gameId);

      const [orgRes, runsRes] = await Promise.all([
        supabase
          .from("trainer_orgs")
          .select(
            "id,name,verified,amenities,cover_url,avatar_url,address,city,hours,timezone,booking_url,website",
          )
          .eq("id", orgId!)
          .maybeSingle(),
        runs,
      ]);
      if (orgRes.error) throw new Error(orgRes.error.message);
      const o = orgRes.data;
      if (!o) return null;
      return {
        id: o.id,
        name: o.name,
        verified: !!o.verified,
        amenities: (o.amenities ?? []) as string[],
        coverUrl: o.cover_url,
        avatarUrl: o.avatar_url,
        place: [o.address, o.city].filter(Boolean).join(" · ") || null,
        hours: o.hours,
        timezone: o.timezone,
        booking: bookingHref({ booking_url: o.booking_url, website: o.website }),
        // A failed count shouldn't hide the card; just omit the counter.
        otherRuns: runsRes.error ? null : (runsRes.count ?? 0),
      };
    },
  });
}

export function otherRunsLabel(n: number | null): string {
  if (n === null) return "See this facility's schedule";
  if (n === 0) return "No other runs scheduled here this week";
  return `${n} other run${n === 1 ? "" : "s"} scheduled here this week`;
}

/** The venue part of what a host typed: "Apex Basketball Hub, 1 Hoop St" → "Apex Basketball Hub". */
export function venueSearchTerm(location: string): string {
  return location.split(",")[0].trim();
}
