/**
 * Server-only automated safety scan for uploaded imagery.
 * Loaded inside server-fn handlers.
 */

export type SafetyVerdict = {
  safe: boolean;
  label: string;
  reason: string | null;
  categories: string[];
  scanned: boolean;
};

const SYSTEM = `You are an image safety classifier for a community sports app.
Respond with ONLY compact JSON: {"safe":boolean,"label":"safe|nudity|sexual|violence|gore|hate|drugs|weapons|self_harm|spam|illegible","categories":string[],"reason":string}
Mark unsafe when the image contains nudity or sexual content, graphic violence or gore, hate symbols, drug use, weapons aimed at people, self-harm, or scam/spam advertising.
Ordinary sports, gym, team, venue, portrait and logo imagery is safe.`;

/**
 * Classify an image with the Lovable AI gateway. Never throws: on any gateway
 * failure the verdict is "scanned: false" so the caller can decide (we let the
 * upload through and leave it in the pending review queue).
 */
export async function scanImageForSafety(imageUrl: string): Promise<SafetyVerdict> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    return { safe: true, label: "unscanned", reason: null, categories: [], scanned: false };
  }

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Classify this uploaded image." },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      return { safe: true, label: "unscanned", reason: null, categories: [], scanned: false };
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return { safe: true, label: "unscanned", reason: null, categories: [], scanned: false };
    }
    const parsed = JSON.parse(match[0]) as {
      safe?: boolean;
      label?: string;
      categories?: unknown;
      reason?: string;
    };
    return {
      safe: parsed.safe !== false,
      label: typeof parsed.label === "string" ? parsed.label : "unknown",
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : null,
      categories: Array.isArray(parsed.categories)
        ? parsed.categories.filter((c): c is string => typeof c === "string").slice(0, 8)
        : [],
      scanned: true,
    };
  } catch {
    return { safe: true, label: "unscanned", reason: null, categories: [], scanned: false };
  }
}
