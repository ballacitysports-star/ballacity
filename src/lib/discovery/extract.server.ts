/**
 * The one AI call discovery makes: read a page, report its organizations.
 *
 * Runs through the shared gate as `listing_discovery`, so the kill switch, the
 * per-plan limits and the usage log apply like any other AI feature. The page
 * is quoted data in the prompt, and the answer goes through `parseExtraction`
 * before anything is stored.
 */

import { runAiCall } from "@/lib/ai/gate.server";
import { AI_ERROR_MESSAGES } from "@/lib/ai/errors";
import { withAiSession } from "@/lib/ai/session.server";
import type { DiscoveryArea, DiscoveryType } from "@/lib/discovery/areas";
import { buildExtractionPrompt, parseExtraction, type Extraction } from "@/lib/discovery/extract";
import type { PageText } from "@/lib/discovery/html";

export async function extractPageOrganizations(
  admin: Parameters<typeof withAiSession>[0]["admin"],
  input: {
    userId: string;
    area: DiscoveryArea;
    types: readonly DiscoveryType[];
    pageUrl: string;
    page: PageText;
    hint?: { name: string | null; sport: string | null } | null;
  },
): Promise<Extraction> {
  return withAiSession(
    { admin, userId: input.userId, feature: "listing_discovery" },
    async (session) => {
      const { system, prompt } = buildExtractionPrompt(input);
      const out = await runAiCall(session, (p) =>
        p.generateStructured<Record<string, unknown>>({ system, prompt }),
      );
      return parseExtraction(out.data, input);
    },
  );
}

/** Errors that mean every further page would fail the same way: stop the run. */
const FATAL = [
  AI_ERROR_MESSAGES.FEATURE_DISABLED,
  AI_ERROR_MESSAGES.CONSENT_REQUIRED,
  AI_ERROR_MESSAGES.PARENT_APPROVAL_REQUIRED,
  AI_ERROR_MESSAGES.QUOTA_EXCEEDED,
  AI_ERROR_MESSAGES.SUBSCRIPTION_REQUIRED,
];

export function isFatalAiMessage(message: string): boolean {
  return FATAL.includes(message);
}
