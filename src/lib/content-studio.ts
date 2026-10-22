/**
 * Content Studio: shared, pure helpers (client and server).
 *
 * The studio never fetches a submitted URL. There is no authorized integration
 * that reads arbitrary Facebook posts, and a public URL is not permission to copy
 * what is behind it, so a submitted link is only parsed, normalised and stored as
 * a reference; a person types the details. Not fetching also means there is no
 * server-side request forgery surface here at all.
 */

import { normalizeHashtags } from "@/lib/social-share";

export const SOURCE_PLATFORMS = ["facebook", "instagram", "web"] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

export const SOURCE_KINDS = ["post", "page", "event", "group", "video", "other"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_STATUSES = ["new", "needs_details", "reviewed", "dismissed"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const LISTING_KINDS = [
  "pickup_game",
  "team",
  "tryout",
  "coach",
  "gym",
  "league",
  "tournament",
  "event",
] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

export const DRAFT_KINDS = [
  "announcement",
  "pickup_game",
  "team",
  "tryout",
  "coach",
  "gym",
  "event",
  "recruitment",
  "reel_concept",
] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const DRAFT_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "publishing",
  "published",
  "failed",
  "rejected",
  "canceled",
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** Fields a person can confirm on a source. Anything not confirmed is shown as unverified. */
export const SOURCE_DETAIL_FIELDS = [
  "title",
  "summary",
  "sport",
  "city",
  "location",
  "event_starts_at",
  "age_group",
  "listing_kind",
  "org_name",
] as const;
export type SourceDetailField = (typeof SOURCE_DETAIL_FIELDS)[number];

export const FACT_STATUSES = ["verified", "unverified", "suggested"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];
export type DraftFact = { claim: string; status: FactStatus };

export const DRAFT_LIMITS = { message: 5000, hashtags: 10, facts: 20, fact: 300 } as const;

// ---------------------------------------------------------------- URLs

export type NormalizedSource = {
  url: string;
  normalizedUrl: string;
  host: string;
  platform: SourcePlatform;
  kind: SourceKind;
};

export type SourceUrlError =
  "URL_INVALID" | "URL_SCHEME" | "URL_CREDENTIALS" | "URL_HOST" | "URL_PORT" | "URL_TOO_LONG";

export class SourceUrlRejected extends Error {
  constructor(public code: SourceUrlError) {
    super(code);
  }
}

const MAX_URL = 2048;

/** Query parameters that only track the click, never identify the content. */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "mibextid",
  "rdid",
  "ref",
  "refsrc",
  "refid",
  "sfnsn",
  "extid",
  "__cft__",
  "__tn__",
  "__xts__",
  "acontext",
  "igshid",
  "igsh",
  "si",
  "s",
  "share_url",
  "app",
  "locale",
]);

const FACEBOOK_HOSTS = ["facebook.com", "fb.com", "fb.watch", "fb.me"];
const INSTAGRAM_HOSTS = ["instagram.com"];

function hostMatches(host: string, base: string) {
  return host === base || host.endsWith(`.${base}`);
}

/** The host with mobile/www prefixes dropped, so one post has one canonical URL. */
function canonicalHost(host: string): string {
  let h = host.toLowerCase().replace(/\.$/, "");
  for (const prefix of ["www.", "m.", "mbasic.", "web.", "touch.", "business."]) {
    if (h.startsWith(prefix)) h = h.slice(prefix.length);
  }
  return h;
}

function platformOf(host: string): SourcePlatform {
  if (FACEBOOK_HOSTS.some((b) => hostMatches(host, b))) return "facebook";
  if (INSTAGRAM_HOSTS.some((b) => hostMatches(host, b))) return "instagram";
  return "web";
}

function kindOf(platform: SourcePlatform, host: string, path: string): SourceKind {
  const p = path.toLowerCase();
  if (platform === "facebook") {
    if (host === "fb.watch" || /\/(watch|videos?|reel|reels)(\/|$)/.test(p)) return "video";
    if (/^\/events(\/|$)/.test(p)) return "event";
    if (/^\/groups(\/|$)/.test(p)) return "group";
    if (/\/(posts|permalink|photos?)(\/|$)|^\/(permalink|story)\.php$|^\/share\/[pr]\//.test(p)) {
      return "post";
    }
    if (p === "/" || p === "") return "other";
    return "page";
  }
  if (platform === "instagram") {
    if (/^\/(reel|reels|tv)\//.test(p)) return "video";
    if (/^\/p\//.test(p)) return "post";
    return "page";
  }
  return "other";
}

function looksLikeIpOrLocal(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.startsWith("[") || host.includes(":")) return true;
  return !host.includes(".");
}

/**
 * Parses and canonicalises a submitted link. Throws SourceUrlRejected for
 * anything that is not a plain public https/http address.
 */
export function normalizeSourceUrl(raw: string): NormalizedSource {
  const input = String(raw ?? "").trim();
  if (!input) throw new SourceUrlRejected("URL_INVALID");
  if (input.length > MAX_URL) throw new SourceUrlRejected("URL_TOO_LONG");

  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`);
  } catch {
    throw new SourceUrlRejected("URL_INVALID");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new SourceUrlRejected("URL_SCHEME");
  if (u.username || u.password) throw new SourceUrlRejected("URL_CREDENTIALS");
  if (u.port && u.port !== "443" && u.port !== "80") throw new SourceUrlRejected("URL_PORT");

  const host = canonicalHost(u.hostname);
  if (!host || looksLikeIpOrLocal(host)) throw new SourceUrlRejected("URL_HOST");

  const platform = platformOf(host);
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()) && !/^utm_/i.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length
    ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`
    : "";
  const path = u.pathname.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1") || "/";

  const normalizedUrl = `https://${host}${path}${query}`;
  if (normalizedUrl.length > MAX_URL) throw new SourceUrlRejected("URL_TOO_LONG");

  return {
    url: input,
    normalizedUrl,
    host,
    platform,
    kind: kindOf(platform, host, path),
  };
}

export const SOURCE_URL_ERROR_MESSAGES: Record<SourceUrlError, string> = {
  URL_INVALID: "That doesn't look like a link. Paste the full address of the post or page.",
  URL_SCHEME: "Only web links (https://) can be submitted.",
  URL_CREDENTIALS: "Links containing a username or password can't be submitted.",
  URL_HOST: "That address isn't a public website.",
  URL_PORT: "Links to a non-standard port can't be submitted.",
  URL_TOO_LONG: "That link is too long.",
};

// ---------------------------------------------------------------- drafts

/**
 * Links in a post must point at BallaCity. A draft is promotion for BallaCity's
 * own pages; it never sends readers to a copied source or a third party.
 */
export function isBallaCityLink(
  raw: string | null | undefined,
  siteHost = "ballacity.com",
): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    return host === siteHost || host === `www.${siteHost}`;
  } catch {
    return false;
  }
}

export function cleanDraftHashtags(tags: readonly string[]): string[] {
  return normalizeHashtags([...tags])
    .map((t) => t.replace(/^#/, ""))
    .filter((t) => t.length <= 40)
    .slice(0, DRAFT_LIMITS.hashtags);
}

export function cleanFacts(input: unknown): DraftFact[] {
  if (!Array.isArray(input)) return [];
  const out: DraftFact[] = [];
  for (const f of input) {
    const claim = String((f as { claim?: unknown })?.claim ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, DRAFT_LIMITS.fact);
    const status = (f as { status?: unknown })?.status;
    if (!claim) continue;
    out.push({
      claim,
      status: (FACT_STATUSES as readonly unknown[]).includes(status)
        ? (status as FactStatus)
        : "unverified",
    });
    if (out.length >= DRAFT_LIMITS.facts) break;
  }
  return out;
}

/** True when the draft still relies on something nobody has confirmed. */
export function hasUnverifiedFacts(facts: readonly DraftFact[]): boolean {
  return facts.some((f) => f.status !== "verified");
}

/**
 * The text Meta receives: the message, then the hashtags on their own line. This
 * is built from the approved payload only, so what is posted is what was approved.
 */
export function composePostMessage(payload: { message: string; hashtags?: readonly string[] }) {
  const tags = (payload.hashtags ?? []).map((t) => `#${t.replace(/^#/, "")}`).join(" ");
  return [payload.message.trim(), tags].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------- settings

export type ContentStudioSettings = {
  /** Staff may submit links and record sources. */
  discovery: boolean;
  /** Staff may ask the AI for a draft. The AI feature flag also applies. */
  aiDrafts: boolean;
  /** A superadmin may publish an approved draft. Off until Meta is set up. */
  publishing: boolean;
  /** Staff may turn a source into an unclaimed team or gym listing. */
  listingCreation: boolean;
};

export const DEFAULT_CONTENT_STUDIO_SETTINGS: ContentStudioSettings = {
  discovery: true,
  aiDrafts: true,
  publishing: false,
  listingCreation: true,
};

export const CONTENT_STUDIO_SETTINGS_KEY = "content_studio";

/** Junk in the settings row falls back to the safe default, field by field. */
export function parseContentStudioSettings(raw: unknown): ContentStudioSettings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = (k: keyof ContentStudioSettings) =>
    typeof src[k] === "boolean" ? (src[k] as boolean) : DEFAULT_CONTENT_STUDIO_SETTINGS[k];
  return {
    discovery: pick("discovery"),
    aiDrafts: pick("aiDrafts"),
    publishing: pick("publishing"),
    listingCreation: pick("listingCreation"),
  };
}

// ---------------------------------------------------------------- Meta Graph API

export const GRAPH_API_VERSION = "v21.0";

/** Permissions the connect flow asks for, and why. Nothing beyond these. */
export const META_PAGE_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
] as const;

export type PublishErrorCode =
  | "TOKEN_EXPIRED"
  | "PERMISSION_MISSING"
  | "RATE_LIMITED"
  | "CONTENT_BLOCKED"
  | "GRAPH_ERROR"
  | "NETWORK_ERROR"
  | "NOT_CONFIGURED";

/** Maps a Graph API error to a code the studio can explain and act on. */
export function classifyGraphError(
  err: { code?: number; error_subcode?: number } | null | undefined,
): PublishErrorCode {
  const code = err?.code;
  if (code === 190 || code === 102 || code === 463 || code === 467) return "TOKEN_EXPIRED";
  if (
    code === 10 ||
    code === 200 ||
    code === 299 ||
    (code !== undefined && code >= 200 && code < 300)
  ) {
    return "PERMISSION_MISSING";
  }
  if (code === 4 || code === 17 || code === 32 || code === 341 || code === 613)
    return "RATE_LIMITED";
  if (code === 368 || code === 1346003) return "CONTENT_BLOCKED";
  return "GRAPH_ERROR";
}

export const PUBLISH_ERROR_MESSAGES: Record<PublishErrorCode, string> = {
  TOKEN_EXPIRED: "The Facebook connection has expired. Reconnect the Page, then retry.",
  PERMISSION_MISSING:
    "Facebook refused: the connection is missing permission to post on this Page.",
  RATE_LIMITED: "Facebook is rate-limiting posts. Wait a few minutes, then retry.",
  CONTENT_BLOCKED: "Facebook blocked this post. Review the content before trying again.",
  GRAPH_ERROR: "Facebook returned an error. Nothing was posted.",
  NETWORK_ERROR:
    "Facebook could not be reached, so nothing was confirmed as posted. Check the Page before retrying.",
  NOT_CONFIGURED: "Publishing is not set up: the Meta app credentials are missing on the server.",
};
