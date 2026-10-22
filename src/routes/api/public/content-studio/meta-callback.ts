import { createFileRoute } from "@tanstack/react-router";

/**
 * Facebook's OAuth redirect lands here after a superadmin connects the Page.
 *
 * Public because Facebook redirects the browser here without the app's session.
 * It is not open: the single-use `state` (created by startMetaConnect for a
 * superadmin, ten-minute expiry, stored hashed) is what authorises the request,
 * and the superadmin role is re-checked for the user who started the flow.
 * Tokens never reach the browser: the redirect carries only a status word.
 */
export const Route = createFileRoute("/api/public/content-studio/meta-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const back = (status: string) =>
          new Response(null, {
            status: 302,
            headers: {
              location: `/superadmin?tab=content-studio&meta=${encodeURIComponent(status)}`,
              "cache-control": "no-store",
              "referrer-policy": "no-referrer",
            },
          });
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { completeMetaConnect } = await import("@/lib/content-studio.server");
          await completeMetaConnect(supabaseAdmin, {
            code: url.searchParams.get("code"),
            state: url.searchParams.get("state"),
            error: url.searchParams.get("error"),
          });
          return back("connected");
        } catch (e) {
          const code = (e as { code?: string })?.code;
          console.error("[content-studio] meta connect failed", code ?? "UNKNOWN");
          return back(typeof code === "string" ? code.toLowerCase() : "error");
        }
      },
    },
  },
});
