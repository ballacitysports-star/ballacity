import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listUpcomingGames from "./tools/list-nearby-games";
import whoami from "./tools/whoami";

// Use the direct Supabase host as the OAuth issuer. SUPABASE_URL is rewritten
// to a proxy on publish, which mcp-js rejects (RFC 8414 issuer mismatch).
// The project ref survives publish unchanged.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "openrun-mcp",
  title: "BallaCity",
  version: "0.1.0",
  instructions:
    "Tools for BallaCity, a pickup-sports app. Use `whoami` to verify the signed-in user, and `list_upcoming_games` to see upcoming games. Callers act as the authenticated BallaCity user; row-level security applies.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoami, listUpcomingGames],
});
