/**
 * Share-out helpers: per-platform intent URLs and caption building.
 * User-initiated only — nothing is published on the user's behalf.
 * Instagram and TikTok have no web share-intent for content, so those
 * platforms are served by the native share sheet / copy instead.
 */
export type SharePlatform = "x" | "facebook" | "whatsapp";

export type ShareContent = {
  title: string;
  text: string;
  url: string;
  hashtags?: string[];
};

const MAX_X_TEXT = 220;

export function normalizeHashtags(tags: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const clean = raw.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(`#${clean}`);
  }
  return out;
}

export function buildCaption(c: ShareContent, opts: { withUrl?: boolean } = {}): string {
  const tags = normalizeHashtags(["BallaCity", ...(c.hashtags ?? [])]).join(" ");
  return [c.text.trim(), tags, opts.withUrl ? c.url : ""].filter(Boolean).join("\n");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

export function platformShareUrl(platform: SharePlatform, c: ShareContent): string {
  const q = encodeURIComponent;
  switch (platform) {
    case "x":
      return `https://twitter.com/intent/tweet?text=${q(truncate(buildCaption(c), MAX_X_TEXT))}&url=${q(c.url)}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${q(c.url)}&quote=${q(c.text.trim())}`;
    case "whatsapp":
      return `https://wa.me/?text=${q(buildCaption(c, { withUrl: true }))}`;
  }
}
