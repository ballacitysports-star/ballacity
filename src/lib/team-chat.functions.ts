import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { teamChatErrorMessage } from "@/lib/team-chat";

const Input = z
  .object({ teamId: z.string().min(1).max(128), body: z.string().trim().min(1).max(2000) })
  .strict();

/**
 * P2-3: post to a team's chat. The text is AI-screened first (blocked text is never stored);
 * send_team_chat_message runs as the member (the database checks they are in the chat and
 * rate-limits) and stores it pending; the service role then approves or holds it.
 */
export const sendTeamChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mod = await import("@/lib/post-moderation.server");
    const screen = await mod.screenPostText(supabaseAdmin, {
      userId: context.userId,
      table: "team_chat_messages",
      context: mod.TEAM_CHAT_CONTEXT,
      fields: { body: data.body },
    });
    if (screen === "block") throw new Error(mod.POST_BLOCKED_MESSAGE);
    const { data: id, error } = await context.supabase.rpc(
      "send_team_chat_message" as never,
      { _team: data.teamId, _body: data.body } as never,
    );
    if (error) throw new Error(teamChatErrorMessage(error.message));
    const messageId = String(id);
    const status = await mod.settlePostModeration(
      supabaseAdmin,
      "team_chat_messages",
      messageId,
      screen,
    );
    return { id: messageId, held: status !== "approved" };
  });
