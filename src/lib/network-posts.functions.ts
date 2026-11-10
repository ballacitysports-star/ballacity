import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { postErrorMessage } from "@/lib/network-posts-rules";

const CreatePostInput = z
  .object({
    postedAs: z.enum(["person", "team", "org"]).default("person"),
    teamId: z.string().min(1).max(128).nullable().optional(),
    orgId: z.string().uuid().nullable().optional(),
    kind: z.enum(["update", "announcement", "achievement", "recap"]).default("update"),
    audience: z.enum(["public", "followers", "team", "family"]),
    body: z.string().trim().min(1).max(2000),
  })
  .strict();

/**
 * Creates a post. The text is screened before it is stored (blocked text never reaches
 * the database), the row is inserted as the member (the database checks who may post as
 * what and to whom, and forces it to pending), then the screen's outcome is recorded with
 * the service role: approved posts become visible, held ones wait for a superadmin.
 */
export const createNetworkPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CreatePostInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mod = await import("@/lib/post-moderation.server");
    const screen = await mod.screenPostText(supabaseAdmin, {
      userId: context.userId,
      table: "posts",
      context: mod.NETWORK_POST_CONTEXT,
      fields: { body: data.body },
    });
    if (screen === "block") throw new Error(mod.POST_BLOCKED_MESSAGE);

    const { data: row, error } = await context.supabase
      .from("posts" as never)
      .insert({
        author_id: context.userId,
        posted_as: data.postedAs,
        team_id: data.teamId ?? null,
        org_id: data.orgId ?? null,
        kind: data.kind,
        audience: data.audience,
        body: data.body,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(postErrorMessage(error.message));
    const id = (row as unknown as { id: string }).id;
    const status = await mod.settlePostModeration(supabaseAdmin, "posts", id, screen);
    return { id, held: status !== "approved" };
  });
