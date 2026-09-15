import {
  ExternalLink,
  Globe,
  Instagram,
  Youtube,
  Facebook,
  Linkedin,
  Twitch,
  Github,
  Music,
} from "lucide-react";
import type { ProfileLink, ProfileLinkType } from "@/lib/user-prefs-store";
import perfectGameLogo from "@/assets/perfect-game-logo.png.asset.json";

export const LINK_TYPES: { type: ProfileLinkType; label: string; placeholder: string }[] = [
  {
    type: "perfect_game",
    label: "Perfect Game",
    placeholder: "perfectgame.org/players/...",
  },
  { type: "pbr", label: "Prep Baseball Report", placeholder: "prepbaseballreport.com/..." },
  { type: "hudl", label: "Hudl", placeholder: "hudl.com/profile/..." },
  { type: "instagram", label: "Instagram", placeholder: "instagram.com/yourhandle" },
  { type: "twitter", label: "X / Twitter", placeholder: "x.com/yourhandle" },
  { type: "tiktok", label: "TikTok", placeholder: "tiktok.com/@yourhandle" },
  { type: "youtube", label: "YouTube", placeholder: "youtube.com/@yourchannel" },
  { type: "website", label: "Website", placeholder: "yoursite.com" },
];

export function linkLabel(type: ProfileLinkType): string {
  return LINK_TYPES.find((l) => l.type === type)?.label ?? type;
}

// Inline SVG icons for brands not in lucide-react
function XIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2H21.5l-7.5 8.57L23 22h-6.844l-5.36-6.99L4.6 22H1.34l8.02-9.17L1 2h7.02l4.84 6.39L18.244 2zm-2.4 18h1.86L7.24 4H5.28l10.564 16z" />
    </svg>
  );
}

function TikTokIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M21 8.5a8.5 8.5 0 0 1-5-1.6V16a6 6 0 1 1-6-6c.34 0 .67.03 1 .09v3.1a3 3 0 1 0 2 2.83V2h3a5.5 5.5 0 0 0 5 5.5v1z" />
    </svg>
  );
}

// Map a hostname to a known type for automatic icon detection
function detectTypeFromUrl(url: string): ProfileLinkType | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (host.includes("instagram.com")) return "instagram";
    if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
    if (host.includes("tiktok.com")) return "tiktok";
    if (host === "x.com" || host.endsWith(".x.com") || host.includes("twitter.com"))
      return "twitter";
    if (host.includes("perfectgame.org")) return "perfect_game";
    if (host.includes("prepbaseballreport.com")) return "pbr";
    if (host.includes("hudl.com")) return "hudl";
  } catch {
    // ignore invalid URLs
  }
  return null;
}

// Extra brand detection beyond the typed ProfileLinkType set
type BrandKey =
  ProfileLinkType | "facebook" | "linkedin" | "twitch" | "github" | "spotify" | "soundcloud";

function detectBrandFromUrl(url: string): BrandKey | null {
  const typed = detectTypeFromUrl(url);
  if (typed) return typed;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (host.includes("facebook.com") || host === "fb.com") return "facebook";
    if (host.includes("linkedin.com")) return "linkedin";
    if (host.includes("twitch.tv")) return "twitch";
    if (host.includes("github.com")) return "github";
    if (host.includes("spotify.com")) return "spotify";
    if (host.includes("soundcloud.com")) return "soundcloud";
  } catch {
    // ignore
  }
  return null;
}

function BrandIcon({ brand, className = "h-4 w-4" }: { brand: BrandKey; className?: string }) {
  switch (brand) {
    case "perfect_game":
      return (
        <img
          src={perfectGameLogo.url}
          alt="Perfect Game"
          width={836}
          height={418}
          loading="lazy"
          decoding="async"
          className={`${className} w-auto object-contain dark:invert`}
        />
      );
    case "instagram":
      return <Instagram className={className} />;
    case "youtube":
      return <Youtube className={className} />;
    case "twitter":
      return <XIcon className={className} />;
    case "tiktok":
      return <TikTokIcon className={className} />;
    case "facebook":
      return <Facebook className={className} />;
    case "linkedin":
      return <Linkedin className={className} />;
    case "twitch":
      return <Twitch className={className} />;
    case "github":
      return <Github className={className} />;
    case "spotify":
    case "soundcloud":
      return <Music className={className} />;
    case "website":
      return <Globe className={className} />;
    default:
      return <ExternalLink className={className} />;
  }
}

export function LinkIcon({
  type,
  url,
  className = "h-4 w-4",
}: {
  type: ProfileLinkType;
  url?: string;
  className?: string;
}) {
  // If the explicit type is generic (website/external), try to detect from URL
  const effectiveBrand: BrandKey =
    (type === "website" && url && detectBrandFromUrl(url)) ||
    (url && detectBrandFromUrl(url)) ||
    type;
  return <BrandIcon brand={effectiveBrand} className={className} />;
}

export function ProfileLinksList({ links }: { links: ProfileLink[] }) {
  if (!links?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((l, i) => (
        <a
          key={i}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:border-lime/40"
        >
          <LinkIcon type={l.type} url={l.url} className="h-3.5 w-3.5" />
          {l.label?.trim() || linkLabel(l.type)}
        </a>
      ))}
    </div>
  );
}
