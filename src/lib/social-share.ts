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

/**
 * Share-sheet content for a game page: the canonical link and a one-line
 * invitation. The venue is left out on purpose; the link carries it.
 */
export function buildGameShare(
  game: { id: string; title: string; sport?: string },
  when: string,
  origin: string,
): ShareContent {
  return {
    title: game.title,
    text: `Come play: ${game.title} · ${when}`,
    url: `${origin}/games/${game.id}`,
    hashtags: game.sport ? [game.sport] : [],
  };
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

/** Path of one reel's public page. isPublicReelPath must match every path this builds. */
export function publicReelPath(reelId: string): string {
  return `/reels/${encodeURIComponent(reelId)}`;
}

/**
 * True only for one reel's public page (/reels/<id>), so the root AuthGate lets a
 * signed-out visitor open a shared link. Deliberately not a /reels prefix: the
 * /reels tab itself is the signed-in studio and must stay gated.
 */
export function isPublicReelPath(pathname: string): boolean {
  return /^\/reels\/[^/]+\/?$/.test(pathname);
}

/** A safe download filename for a reel, keeping the stored file's extension. */
export function reelDownloadName(title: string, storagePath: string): string {
  const ext = /\.(mp4|mov|m4v|webm)$/i.exec(storagePath)?.[1]?.toLowerCase() ?? "mp4";
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug || "ballacity-reel"}.${ext}`;
}
