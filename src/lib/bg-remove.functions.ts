import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Remove background from an image using Lovable AI Gateway
 * (google/gemini-2.5-flash-image, edit mode). Returns a base64 PNG data URL.
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
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Remove the background from this image. Keep the main subject perfectly intact with clean edges. Return a transparent PNG with only the subject on transparency.",
              },
              { type: "image_url", image_url: { url: data.dataUrl } },
            ],
          },
        ],
        modalities: ["image", "text"],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Rate limited — try again in a moment");
      if (res.status === 402) throw new Error("AI credits exhausted — add credits in Settings");
      throw new Error(`Background removal failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
    };
    const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url || !url.startsWith("data:image/")) {
      throw new Error("No image returned by the AI");
    }
    return { dataUrl: url };
  });
