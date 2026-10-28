/**
 * Everything discovery fetches from the network (server only).
 *
 *  - Pages: read directly, politely. robots.txt is checked first, redirects may
 *    not leave the site, size and time are capped, and only public http(s)
 *    addresses are ever requested. A page that renders in the browser with
 *    script (almost no text in the raw HTML) falls back to Firecrawl when a key
 *    is configured.
 *  - Web search and the script-rendering fallback: Firecrawl (FIRECRAWL_API_KEY).
 *  - OpenStreetMap leads: the Overpass API.
 *
 * The key is read from the server environment and never leaves it.
 */

import type { DiscoveryArea, DiscoveryType, OsmLead } from "@/lib/discovery/areas";
import { overpassQuery, parseOverpass } from "@/lib/discovery/areas";
import { htmlToPageText, isThinPage, type PageText } from "@/lib/discovery/html";
import {
  BOT_USER_AGENT,
  hostKey,
  isPublicHttpUrl,
  normalizeWebUrl,
  robotsFromResponse,
} from "@/lib/discovery/urls";

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2";
/**
 * Public Overpass servers, tried in order. They are volunteer-run and go down or
 * fill up often (the first live run failed with HTTP 521 and 522 from the only
 * server it knew), so a lookup moves on to the next one instead of giving up.
 */
export const OVERPASS_ENDPOINTS: readonly string[] = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
/** Three attempts must fit well inside a request's lifetime, so each is short. */
const OVERPASS_ATTEMPT_MS = 25_000;

const PAGE_TIMEOUT_MS = 10_000;
const ROBOTS_TIMEOUT_MS = 6_000;
const MAX_PAGE_BYTES = 800_000;
const MAX_ROBOTS_BYTES = 200_000;
const MAX_REDIRECTS = 4;

export function firecrawlConfigured(): boolean {
  return Boolean(process.env["FIRECRAWL_API_KEY"]);
}

export type SearchHit = { url: string; title: string; description: string };

export type FetchResult =
  | { ok: true; url: string; page: PageText; via: "direct" | "firecrawl" }
  | { ok: false; reason: string };

/** Reads at most `max` bytes of a response body as text. */
async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(total, max));
  let offset = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, all.length - offset);
    all.set(c.subarray(0, take), offset);
    offset += take;
    if (offset >= all.length) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}

/**
 * GET that follows redirects only within the same site, re-checking each hop
 * is still a public address. Returns null when it would leave the site.
 */
async function getSameSite(
  url: string,
  timeoutMs: number,
  accept: string,
): Promise<{ res: Response; finalUrl: string } | null> {
  let current = url;
  const site = hostKey(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": BOT_USER_AGENT, Accept: accept },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!loc) return null;
      let next: string;
      try {
        next = new URL(loc, current).toString();
      } catch {
        return null;
      }
      if (!isPublicHttpUrl(next) || hostKey(next) !== site) return null;
      current = next;
      continue;
    }
    return { res, finalUrl: current };
  }
  return null;
}

async function robotsAllows(url: string): Promise<boolean> {
  const u = new URL(url);
  let status: number | null = null;
  let body = "";
  try {
    const got = await getSameSite(`${u.origin}/robots.txt`, ROBOTS_TIMEOUT_MS, "text/plain");
    if (got) {
      status = got.res.status;
      body = status >= 200 && status < 300 ? await readCapped(got.res, MAX_ROBOTS_BYTES) : "";
      if (status >= 300) await got.res.body?.cancel().catch(() => {});
    }
  } catch {
    status = null;
  }
  return robotsFromResponse(status, body).allows(`${u.pathname}${u.search}`);
}

async function firecrawlScrape(url: string): Promise<PageText | null> {
  const key = process.env["FIRECRAWL_API_KEY"];
  if (!key) return null;
  try {
    const res = await fetch(`${FIRECRAWL_URL}/scrape`, {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { markdown?: string; metadata?: { title?: string; description?: string } };
    };
    const markdown = json.data?.markdown;
    if (!markdown) return null;
    return {
      title: String(json.data?.metadata?.title ?? "").slice(0, 200),
      description: String(json.data?.metadata?.description ?? "").slice(0, 400),
      jsonLd: [],
      text: markdown.slice(0, 12_000),
    };
  } catch {
    return null;
  }
}

/** Reads one public page, or says why not. Never throws. */
export async function fetchPage(rawUrl: string): Promise<FetchResult> {
  const url = normalizeWebUrl(rawUrl);
  if (!url) return { ok: false, reason: "not a fetchable address" };
  try {
    if (!(await robotsAllows(url))) return { ok: false, reason: "blocked by robots.txt" };

    const got = await getSameSite(url, PAGE_TIMEOUT_MS, "text/html,application/xhtml+xml");
    if (!got) return { ok: false, reason: "redirected away or unreachable" };
    const { res, finalUrl } = got;
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!type.includes("html") && !type.includes("text/plain")) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: "not a web page" };
    }
    const page = htmlToPageText(await readCapped(res, MAX_PAGE_BYTES));
    if (!isThinPage(page)) return { ok: true, url: finalUrl, page, via: "direct" };

    const rendered = await firecrawlScrape(finalUrl);
    if (rendered && !isThinPage(rendered)) {
      return { ok: true, url: finalUrl, page: rendered, via: "firecrawl" };
    }
    return { ok: false, reason: "page has no readable text" };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error && e.name === "TimeoutError" ? "timed out" : "fetch failed",
    };
  }
}

/** Web search through Firecrawl. Throws when it is not configured or fails. */
export async function searchWeb(query: string, limit = 10): Promise<SearchHit[]> {
  const key = process.env["FIRECRAWL_API_KEY"];
  if (!key) throw new Error("Web search is not configured (FIRECRAWL_API_KEY).");
  const res = await fetch(`${FIRECRAWL_URL}/search`, {
    method: "POST",
    signal: AbortSignal.timeout(40_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit, sources: ["web"], country: "US" }),
  });
  if (!res.ok) throw new Error(`Web search failed (HTTP ${res.status}).`);
  const json = (await res.json()) as { data?: unknown };
  // Newer responses nest results under data.web; older ones return a bare array.
  const list = Array.isArray(json.data)
    ? json.data
    : ((json.data as { web?: unknown } | undefined)?.web ?? []);
  if (!Array.isArray(list)) return [];
  return list
    .map((r) => r as Record<string, unknown>)
    .filter((r) => typeof r["url"] === "string")
    .map((r) => ({
      url: String(r["url"]),
      title: String(r["title"] ?? "").slice(0, 200),
      description: String(r["description"] ?? "").slice(0, 400),
    }));
}

/** Busy, down or timed out (including Cloudflare's 52x errors): another server may answer. */
const worthAnotherServer = (status: number) => status === 408 || status === 429 || status >= 500;

/**
 * Runs an Overpass query against the first server that answers. A server that
 * is busy, down or too slow is skipped; an answer that says the query itself is
 * wrong (any other error) stops at once, because every server would agree.
 */
export async function fetchOverpass(
  query: string,
  opts: { endpoints?: readonly string[]; fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<unknown> {
  const fetchFn = opts.fetchFn ?? fetch;
  const override = process.env["OVERPASS_URL"];
  const endpoints = opts.endpoints ?? [
    ...(override ? [override] : []),
    ...OVERPASS_ENDPOINTS.filter((u) => u !== override),
  ];
  const failures: string[] = [];

  for (const url of endpoints) {
    const host = new URL(url).hostname;
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: "POST",
        signal: AbortSignal.timeout(opts.timeoutMs ?? OVERPASS_ATTEMPT_MS),
        headers: {
          "User-Agent": BOT_USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
    } catch (e) {
      failures.push(
        `${host}: ${e instanceof Error && e.name === "TimeoutError" ? "too slow" : "unreachable"}`,
      );
      continue;
    }
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as { elements?: unknown } | null;
      if (json && Array.isArray(json.elements)) return json;
      failures.push(`${host}: unreadable answer`);
      continue;
    }
    await res.body?.cancel().catch(() => {});
    if (!worthAnotherServer(res.status)) {
      throw new Error(`OpenStreetMap lookup failed (HTTP ${res.status}).`);
    }
    failures.push(`${host}: HTTP ${res.status}`);
  }
  throw new Error(`The OpenStreetMap servers are busy or down (${failures.join("; ")}).`);
}

/** Mapped places in the area that list a website, from OpenStreetMap. */
export async function osmLeads(area: DiscoveryArea, type: DiscoveryType): Promise<OsmLead[]> {
  return parseOverpass(await fetchOverpass(overpassQuery(area, type)));
}
