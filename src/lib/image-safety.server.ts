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
  try {
    const { loadAiConfig } = await import("@/lib/ai/settings.server");
    const { createLovableGatewayProvider } = await import("@/lib/ai/gateway.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const config = await loadAiConfig(supabaseAdmin);
    // Not gated on the kill switch — safety scanning stays on when AI is off.
    if (!config.features.features.image_moderation.enabled) {
      return { safe: true, label: "unscanned", reason: null, categories: [], scanned: false };
    }
    const verdict = await createLovableGatewayProvider(config.provider).moderateImage({ imageUrl });
    return {
      safe: verdict.safe,
      label: verdict.label,
      reason: verdict.reason,
      categories: verdict.categories,
      scanned: true,
    };
  } catch {
    // Unchanged contract: a scan failure leaves the image in the pending queue.
    return { safe: true, label: "unscanned", reason: null, categories: [], scanned: false };
  }
}
