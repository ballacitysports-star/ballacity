/**
 * Which web addresses discovery may fetch, and how robots.txt is applied.
 *
 * Addresses come from search results and OpenStreetMap tags, so they are
 * untrusted input to a server-side fetch: only plain public http(s) sites on
 * ordinary ports are allowed, never an IP address, an internal name or a
 * login-bearing URL. A public-looking name that a DNS record points at a
 * private address is not caught here; that relies on the Workers runtime, which
 * cannot reach private networks from `fetch`.
 *
 * Social networks, review sites and search engines are never fetched, because
 * their terms forbid automated reading; the organization's own website is the
 * only source of facts.
 */

/** The name we send, and the name robots.txt rules are matched against. */
export const BOT_TOKEN = "ballacitybot";
export const BOT_USER_AGENT =
  "BallaCityBot/1.0 (listing discovery; reads public pages; respects robots.txt)";

/** Hosts (and everything under them) that are never fetched. */
const BLOCKED_SUFFIXES = [
  "facebook.com",
  "fb.com",
  "fb.me",
  "instagram.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "linkedin.com",
  "youtube.com",
  "youtu.be",
  "pinterest.com",
  "snapchat.com",
  "reddit.com",
  "nextdoor.com",
  "yelp.com",
  "tripadvisor.com",
  "yellowpages.com",
  "mapquest.com",
  "google.com",
  "goo.gl",
  "g.page",
  "bing.com",
  "duckduckgo.com",
  "wikipedia.org",
  "amazon.com",
  "ebay.com",
];

const INTERNAL_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".lan",
  ".home",
  ".corp",
  ".intranet",
];

const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_)/i;

/** Host without a leading "www.", lowercased. */
export function hostKey(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return BLOCKED_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

/** True for a plain public web address we are willing to fetch. */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "80" && u.port !== "443") return false;
  const host = u.hostname.toLowerCase();
  if (!host || host.includes(":") || host.startsWith("[")) return false; // IPv6 literal
  if (/^[0-9.]+$/.test(host)) return false; // IPv4 literal (including odd forms)
  if (/^0x[0-9a-f]+$/i.test(host)) return false;
  if (!host.includes(".")) return false; // "localhost", intranet names
  if (INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) return false;
  return !isBlockedHost(host);
}

/**
 * A clean https/http address, or null. Adds a missing scheme, drops fragments
 * and tracking parameters, and rejects anything {@link isPublicHttpUrl} would.
 */
export function normalizeWebUrl(raw: string | null | undefined): string | null {
  let s = String(raw ?? "").trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
  }
  const out = u.toString();
  return isPublicHttpUrl(out) ? out : null;
}

/* ------------------------------- robots.txt ------------------------------- */

export type RobotsRules = { allows: (path: string) => boolean };

type Rule = { allow: boolean; pattern: string };

const ALLOW_ALL: RobotsRules = { allows: () => true };
const DENY_ALL: RobotsRules = { allows: () => false };

/** A robots.txt path pattern ("*" any run, "$" end) as a prefix matcher. */
function patternMatches(pattern: string, path: string): number {
  // Returns the length of the match (for longest-match precedence), or -1.
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(
    `^${body
      .split("*")
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}${anchored ? "$" : ""}`,
  );
  return re.test(path) ? body.replace(/\*/g, "").length : -1;
}

/**
 * Rules for our crawler from a robots.txt body: the group naming us, else "*".
 * Longest matching rule wins and Allow beats Disallow on a tie (RFC 9309).
 */
export function parseRobots(body: string): RobotsRules {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "allow" || field === "disallow") {
      lastWasAgent = false;
      if (current && value) current.rules.push({ allow: field === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }

  const named = groups.filter((g) => g.agents.some((a) => a.split("/")[0] === BOT_TOKEN));
  const chosen = named.length ? named : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  if (!rules.length) return ALLOW_ALL;

  return {
    allows(path: string) {
      let best: { len: number; allow: boolean } | null = null;
      for (const r of rules) {
        const len = patternMatches(r.pattern, path);
        if (len < 0) continue;
        if (!best || len > best.len || (len === best.len && r.allow)) {
          best = { len, allow: r.allow };
        }
      }
      return best ? best.allow : true;
    },
  };
}

/**
 * What a robots.txt fetch means (RFC 9309): found → its rules; any 4xx →
 * no restrictions; a server error or no answer → treat the site as off limits.
 */
export function robotsFromResponse(status: number | null, body: string): RobotsRules {
  if (status == null) return DENY_ALL;
  if (status >= 200 && status < 300) return parseRobots(body);
  if (status >= 400 && status < 500) return ALLOW_ALL;
  return DENY_ALL;
}
