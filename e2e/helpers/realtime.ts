import { expect, type Page } from "@playwright/test";

/**
 * Wait until `page` holds a joined realtime channel whose topic contains
 * `topicPart` (topics as created in src/, e.g. "player-orgs:<uid>",
 * "game_participants:roster:<gameId>", "game_participants:game:<gameId>").
 *
 * Realtime specs change data on another client and expect the open page to
 * follow. The page subscribes asynchronously after it renders, so a change
 * made before the subscription is joined is never delivered, and surfaces
 * that do not re-read on subscribe (e.g. the player profile's Organizations
 * section) then miss it for good. Make the change only once the page listens.
 */
export async function realtimeJoined(page: Page, topicPart: string) {
  await expect
    .poll(
      () =>
        page
          .evaluate(async (part) => {
            // @ts-expect-error - dev-server module path
            const mod = await import("/src/integrations/supabase/client.ts");
            const channels = (
              mod as { supabase: { getChannels: () => { topic: string; state: string }[] } }
            ).supabase.getChannels();
            return channels.some((c) => c.topic.includes(part) && c.state === "joined");
          }, topicPart)
          .catch(() => false),
      { timeout: 20_000, message: `no joined realtime channel for "${topicPart}"` },
    )
    .toBe(true);
}
