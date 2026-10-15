import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import {
  bucketByCity,
  emptyListings,
  filterBySport,
  isAdultsOnlyGame,
  isPublicUpcomingGame,
  sportForGuideSlug,
  type CityGameRow,
  type CityListings,
} from "./city-seo";
import { cityBounds, cityBySlug } from "./launch-cities";

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

// Public columns only: no host identity, roster, or contact details.
export const CITY_GAME_COLUMNS =
  "id,title,sport,date,location,neighborhood,price,skill,lat,lng,min_age,max_age,is_private,hidden_at,org_hidden_at,cancelled_at,updated_at";
export const CITY_ORG_COLUMNS = "id,name,city,sports,kind,tagline,age_groups,hidden_at,updated_at";
export const CITY_GYM_COLUMNS = "id,name,city,category,hidden_at,updated_at";

/**
 * Everything public in one launch city, optionally narrowed to one sport
 * (by guide slug). Returns null for an unknown city or sport slug so the
 * route can 404 instead of serving an empty indexable page.
 */
export const getCityListings = createServerFn({ method: "GET" })
  .inputValidator((d: { city: string; sport?: string }) =>
    z.object({ city: z.string().max(60), sport: z.string().max(40).optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<{ listings: CityListings } | null> => {
    const city = cityBySlug(data.city);
    if (!city) return null;
    const sport = data.sport ? sportForGuideSlug(data.sport) : undefined;
    if (data.sport && !sport) return null;

    const sb = publicClient();
    const b = cityBounds(city);
    const namePrefix = `${city.name.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const [games, orgs, gyms] = await Promise.all([
      sb
        .from("hosted_games")
        .select(CITY_GAME_COLUMNS)
        .eq("is_private", false)
        .is("hidden_at", null)
        .is("org_hidden_at", null)
        .is("cancelled_at", null)
        .gte("date", new Date().toISOString())
        .gte("lat", b.minLat)
        .lte("lat", b.maxLat)
        .gte("lng", b.minLng)
        .lte("lng", b.maxLng)
        .order("date", { ascending: true })
        .limit(200),
      sb
        .from("teams")
        .select(CITY_ORG_COLUMNS)
        .is("hidden_at", null)
        .ilike("city", namePrefix)
        .limit(200),
      sb
        .from("trainer_orgs")
        .select(CITY_GYM_COLUMNS)
        .is("hidden_at", null)
        .ilike("city", namePrefix)
        .limit(200),
    ]);
    if (games.error) throw new Error(games.error.message);
    if (orgs.error) throw new Error(orgs.error.message);
    if (gyms.error) throw new Error(gyms.error.message);

    // Re-bucket so the page applies exactly the same rules (and the same
    // nearest-city tie-break) as the sitemap.
    const listings =
      bucketByCity({ games: games.data ?? [], orgs: orgs.data ?? [], gyms: gyms.data ?? [] }).get(
        city.slug,
      ) ?? emptyListings();
    return { listings: sport ? filterBySport(listings, sport) : listings };
  });

/** Minimal public facts about a game, for its page title and structured data. */
export type PublicGameSeo = {
  id: string;
  title: string;
  sport: string;
  date: string;
  location: string;
  neighborhood: string;
  price: number;
  description: string;
  /** False for private, hidden, cancelled, past, or youth games: noindex. */
  indexable: boolean;
  /** True when the host limited the game to 18+. Only these get the signed-out preview. */
  adultsOnly: boolean;
};

export const getPublicGameSeo = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data }): Promise<PublicGameSeo | null> => {
    const { data: row, error } = await publicClient()
      .from("hosted_games")
      .select(`${CITY_GAME_COLUMNS},description`)
      .eq("id", data.id)
      .maybeSingle();
    if (error || !row) return null;
    const g = row as unknown as CityGameRow & { description: string };
    // Never describe a youth or private game to a crawler.
    const indexable = isPublicUpcomingGame(g);
    return {
      id: g.id,
      title: indexable ? g.title : "Pickup game",
      sport: g.sport,
      date: g.date,
      location: indexable ? g.location : "",
      neighborhood: indexable ? g.neighborhood : "",
      price: g.price,
      description: indexable ? g.description : "",
      indexable,
      adultsOnly: indexable && isAdultsOnlyGame(g),
    };
  });
