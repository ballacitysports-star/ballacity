import { expect, type Page } from "@playwright/test";

type ChannelInfo = { topic: string; state: string };

async function channelsOf(page: Page): Promise<ChannelInfo[] | null> {
  return page
    .evaluate(async () => {
      // @ts-expect-error - dev-server module path
      const mod = await import("/src/integrations/supabase/client.ts");
      return (
        mod as { supabase: { getChannels: () => { topic: string; state: string }[] } }
      ).supabase
        .getChannels()
        .map((c) => ({ topic: c.topic, state: c.state }));
    })
    .catch(() => null);
}

const realtimeLogs = new WeakMap<Page, string[]>();

/** Start keeping the page's realtime-related console output (for failures). */
function watchRealtimeLog(page: Page): string[] {
  let lines = realtimeLogs.get(page);
  if (!lines) {
    const collected: string[] = [];
    page.on("console", (m) => {
      const t = m.text();
      if (/realtime|channel|websocket|subscri/i.test(t)) collected.push(`${m.type()}: ${t}`);
    });
    realtimeLogs.set(page, collected);
    lines = collected;
  }
  return lines;
}

/**
 * Wait until `page` holds a joined realtime channel whose topic contains
 * `topicPart` (topics as created in src/, e.g. "player-orgs:<uid>",
 * "game_participants:game:<gameId>", "game_participants:me:<uid>").
 *
 * Realtime specs change data on another client and expect the open page to
 * follow. The page subscribes asynchronously after it renders, so a change
 * made before the subscription is joined is never delivered, and surfaces
 * that do not re-read on subscribe (e.g. the player profile's Organizations
 * section) then miss it for good. Make the change only once the page listens.
 *
 * On timeout the failure lists every channel the page holds with its state,
 * and its realtime console output, so CI shows whether the channel is missing,
 * still joining, or refused.
 */
export async function realtimeJoined(page: Page, topicPart: string) {
  const log = watchRealtimeLog(page);
  let last: ChannelInfo[] | null = null;
  try {
    await expect
      .poll(
        async () => {
          last = await channelsOf(page);
          return !!last?.some((c) => c.topic.includes(topicPart) && c.state === "joined");
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  } catch {
    throw new Error(
      `no joined realtime channel for "${topicPart}".\n` +
        `channels on ${page.url()}: ${JSON.stringify(last)}\n` +
        `realtime console:\n${log.slice(-10).join("\n") || "(none)"}`,
    );
  }
}
