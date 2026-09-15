import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BG_REMOVE_PROMPT =
  "Remove the background from this image. Keep the main subject perfectly intact with clean edges. Return a transparent PNG with only the subject on transparency.";

/**
 * Remove background from an image using the shared AI layer
 * (google/gemini-2.5-flash-image, edit mode). Returns a base64 PNG data URL.
 *
 * The gate (`withAiSession` → `assertAiAllowed`) supplies the feature flag,
 * consent/child-policy, cohort and quota checks this function previously had
 * none of, and records usage against an `ai_generation_jobs` row.
 */
export const removeBackground = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { dataUrl: string }) => {
    if (!input?.dataUrl || typeof input.dataUrl !== "string") {
      throw new Error("dataUrl is required");
    }
    if (!input.dataUrl.startsWith("data:image/")) {
      throw new Error("dataUrl must be an image data URL");
    }
    if (input.dataUrl.length > 20 * 1024 * 1024) {
      throw new Error("Image too large — please crop first");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { withAiSession } = await import("@/lib/ai/session.server");
    const { rawChat } = await import("@/lib/ai/gateway.server");

    return withAiSession(
      { userId: context.userId, feature: "background_remove" },
      async () => {
        const out = await rawChat({
          model: "google/gemini-2.5-flash-image",
          modalities: ["image", "text"],
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: BG_REMOVE_PROMPT },
                { type: "image_url", image_url: { url: data.dataUrl } },
              ],
            },
          ],
        });

        const url = (out.message as { images?: { image_url?: { url?: string } }[] } | null)
          ?.images?.[0]?.image_url?.url;
        if (!url || !url.startsWith("data:image/")) {
          throw new Error("No image returned by the AI");
        }
        return { dataUrl: url };
      },
    );
  });
