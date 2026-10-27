import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SUPPORT_MAX_HISTORY, SUPPORT_MAX_HISTORY_ITEM, SUPPORT_MAX_MESSAGE } from "./triage";

const AskInput = z.object({
  message: z.string().trim().min(1, "Type a question first.").max(SUPPORT_MAX_MESSAGE),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(SUPPORT_MAX_HISTORY_ITEM * 2),
      }),
    )
    .max(SUPPORT_MAX_HISTORY * 2)
    .default([]),
});

/**
 * One turn of BallaCity Help. Signed-in members only: the AI gate (feature
 * flag, consent, age cohort, quota) needs a member to charge the call to, and
 * signed-out visitors get the written quick answers instead.
 */
export const askSupportAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AskInput.parse(input))
  .handler(async ({ data, context }) => {
    const { answerSupportQuestion } = await import("./assistant.server");
    return answerSupportQuestion({
      supabase: context.supabase,
      userId: context.userId,
      message: data.message,
      history: data.history,
    });
  });
