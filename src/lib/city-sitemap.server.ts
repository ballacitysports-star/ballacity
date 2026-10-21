import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  bucketByCity,
  citySitemapEntries,
  entitySitemapEntries,
  type CityGameRow,
  type CityGymRow,
  type CityOrgRow,
} from "./city-seo";
import { CITY_GAME_COLUMNS, CITY_GYM_COLUMNS, CITY_ORG_COLUMNS } from "./city-pages.functions";
import { LAUNCH_CITIES } from "./launch-cities";

/**
 * Sitemap rows for launch-city pages plus public games, teams and trainers.
 * Reads with the service role, so every public/minor rule is applied in
 * `city-seo` rather than relying on RLS.
 */
export async function loadCitySitemapEntries() {
  const nowIso = new Date().toISOString();
  const [games, orgs, gyms] = await Promise.all([
    supabaseAdmin
      .from("hosted_games")
      .select(CITY_GAME_COLUMNS)
      .eq("is_private", false)
      .is("hidden_at", null)
      .is("org_hidden_at", null)
      .is("cancelled_at", null)
      .gte("date", nowIso)
      .order("date", { ascending: true })
      .limit(5000),
    supabaseAdmin.from("teams").select(CITY_ORG_COLUMNS).is("hidden_at", null).limit(5000),
    supabaseAdmin.from("trainer_orgs").select(CITY_GYM_COLUMNS).is("hidden_at", null).limit(5000),
  ]);
  const rows = {
    games: (games.data ?? []) as CityGameRow[],
    orgs: (orgs.data ?? []) as CityOrgRow[],
    gyms: (gyms.data ?? []) as CityGymRow[],
  };
  return [...citySitemapEntries(LAUNCH_CITIES, bucketByCity(rows)), ...entitySitemapEntries(rows)];
}
