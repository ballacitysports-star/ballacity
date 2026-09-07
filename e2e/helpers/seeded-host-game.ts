/**
 * Shared setup for the host-name specs.
 *
 * These specs assert one thing: the host name rendered on a game's detail page
 * and feed card comes from the stored `host_snapshot.name` and never degrades
 * to the account's email local-part or to `rowToGame`'s "Host" placeholder —
 * including on a cold deep-link, under slow `profiles` reads, and across
 * realtime-driven refetches.
 *
 * They used to reach that state by driving the whole /create form. That
 * stopped working when hosting was gated behind owning a team profile: the
 * fixture account owns none, so /create renders the "Host as a team" screen,
 * which has no form and no publish button. The specs were committed in the
 * same change that introduced that gate, so they never actually passed.
 *
 * Publishing a game is not what they are testing, and the create-time snapshot
 * resolution already has direct unit coverage in src/lib/host-snapshot.test.ts.
 * So serve the row instead, the way the pay-* specs already do: intercept
 * /rest/v1/hosted_games and fulfil it. That keeps the assertions pointed at the
 * read path, needs no team, no host-responsibility acknowledgement, and no
 * database write to clean up afterwards.
 */
import { expect, type Page } from "@playwright/test";

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

/** `rowToGame` falls back to this when a row carries no snapshot name. */
export const HOST_PLACEHOLDER = "Host";

/** The account's `user_metadata.display_name` — what the host name must be. */
export function sessionDisplayName(): string {
  const session = JSON.parse(SESSION_JSON!);
  const meta = session?.user?.user_metadata ?? {};
  const name: string | undefined = meta.display_name || meta.full_name || meta.name;
  expect(name, "test account must have user_metadata.display_name").toBeTruthy();
  return name!;
}

/** The local-part of the account's email — the value that must never render. */
export function emailLocalPart(): string | null {
  try {
    const session = JSON.parse(SESSION_JSON!);
    const email: string | undefined = session?.user?.email;
    return email ? email.split("@")[0] : null;
  } catch {
    return null;
  }
}

function sessionUserId(): string {
  const session = JSON.parse(SESSION_JSON!);
  return session?.user?.id ?? "00000000-0000-0000-0000-000000000000";
}

export async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

function isTable(url: URL | string, table: string) {
  return String(url).includes(`/rest/v1/${table}`);
}

export type SeededGame = {
  id: string;
  title: string;
  /** The name the page must render as host. */
  hostName: string;
  url: string;
};

/**
 * Serve one hosted game owned by the signed-in account, carrying `hostName` as
 * its snapshot name. Covers both the single-row read on the detail page and
 * the list read behind the feed, since both hit /rest/v1/hosted_games.
 *
 * `delayMs` throttles that endpoint, standing in for a slow connection on a
 * cold open. Install before navigating.
 */
export async function seedHostedGame(
  page: Page,
  opts: { idSuffix: string; hostName: string; delayMs?: number },
): Promise<SeededGame> {
  const id = `e2e-host-name-${opts.idSuffix}`;
  const title = `E2E host name ${opts.idSuffix}`;
  const now = new Date().toISOString();

  const row = {
    id,
    sport: "Basketball",
    title,
    host_snapshot: {
      name: opts.hostName,
      username: "e2ehost",
      avatar: "",
      rating: 5,
    },
    host_id: sessionUserId(),
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    duration: "60 min",
    location: "E2E Court",
    neighborhood: "Testville",
    distance_mi: 1,
    lat: 40.7,
    lng: -74,
    max_players: 10,
    joined: 1,
    skill: "All Levels",
    price: 0,
    indoor: false,
    is_private: false,
    urgent: false,
    trending: false,
    image: "",
    description: "seeded row for the host-name specs",
    equipment: [],
    status: "scheduled",
    joins_closed: false,
    positions_needed: {},
    created_at: now,
    updated_at: now,
  };

  await page.route(
    (url) => isTable(url, "hosted_games"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: JSON.stringify([row]),
      });
    },
  );

  return { id, title, hostName: opts.hostName, url: `/games/${id}` };
}

/** Slow every `profiles` read, the way a bad connection would. */
export async function throttleProfileReads(page: Page, delayMs: number) {
  await page.route(
    (url) => isTable(url, "profiles"),
    async (route) => {
      await new Promise((r) => setTimeout(r, delayMs));
      await route.continue();
    },
  );
}

/**
 * Assert the host name is shown and neither forbidden value is. `forbidden`
 * is the email local-part when it differs from the display name.
 */
export async function expectHostName(
  page: Page,
  hostName: string,
  forbidden: string | null,
  timeout = 15_000,
) {
  await expect(page.getByText(hostName, { exact: false }).first()).toBeVisible({ timeout });
  if (forbidden && forbidden !== hostName) {
    await expect(page.getByText(new RegExp(`^${forbidden}$`))).toHaveCount(0);
  }
  await expect(page.getByText(new RegExp(`^${HOST_PLACEHOLDER}$`))).toHaveCount(0);
}

/**
 * Poll the page for `durationMs`, reporting whether any forbidden value ever
 * appeared. Catches a transient flicker that a single assertion would miss.
 */
export async function watchForForbidden(
  page: Page,
  forbidden: string | null,
  durationMs: number,
  intervalMs = 150,
): Promise<{ seen: string | null }> {
  const candidates = [forbidden, HOST_PLACEHOLDER].filter(Boolean) as string[];
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    const text =
      (await page
        .locator("body")
        .innerText()
        .catch(() => "")) || "";
    for (const value of candidates) {
      if (new RegExp(`(^|\\s|>)${value}(\\s|<|$)`).test(text)) return { seen: value };
    }
    await page.waitForTimeout(intervalMs);
  }
  return { seen: null };
}
