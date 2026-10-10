import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_upcoming_games",
  title: "List upcoming games",
  description:
    "List upcoming pickup games visible to the signed-in BallaCity user, ordered by date.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Max number of games to return (default 20)."),
    sport: z
      .string()
      .optional()
      .describe("Optional sport filter, e.g. 'basketball', 'soccer', 'pickleball'."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, sport }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const today = new Date().toISOString().slice(0, 10);
    let query = supabaseForUser(ctx)
      .from("hosted_games")
      .select(
        "id,title,sport,date,duration,location,neighborhood,skill,price,joined,max_players,host_id",
      )
      .gte("date", today)
      .order("date", { ascending: true })
      .limit(limit ?? 20);
    if (sport) query = query.eq("sport", sport);
    const { data, error } = await query;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { games: data ?? [] },
    };
  },
});
