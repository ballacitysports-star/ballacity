import { ExternalLink, Globe, Instagram, Youtube } from "lucide-react";
import type { ProfileLink, ProfileLinkType } from "@/lib/user-prefs-store";

export const LINK_TYPES: { type: ProfileLinkType; label: string; placeholder: string }[] = [
  { type: "perfect_game", label: "Perfect Game", placeholder: "https://perfectgame.org/players/..." },
  { type: "pbr", label: "Prep Baseball Report", placeholder: "https://prepbaseballreport.com/..." },
  { type: "hudl", label: "Hudl", placeholder: "https://hudl.com/profile/..." },
  { type: "instagram", label: "Instagram", placeholder: "https://instagram.com/yourhandle" },
  { type: "twitter", label: "X / Twitter", placeholder: "https://x.com/yourhandle" },
  { type: "tiktok", label: "TikTok", placeholder: "https://tiktok.com/@yourhandle" },
  { type: "youtube", label: "YouTube", placeholder: "https://youtube.com/@yourchannel" },
  { type: "website", label: "Website", placeholder: "https://yoursite.com" },
];

export function linkLabel(type: ProfileLinkType): string {
  return LINK_TYPES.find((l) => l.type === type)?.label ?? type;
}

export function LinkIcon({ type, className = "h-4 w-4" }: { type: ProfileLinkType; className?: string }) {
  switch (type) {
    case "instagram": return <Instagram className={className} />;
    case "youtube": return <Youtube className={className} />;
    case "website": return <Globe className={className} />;
    default: return <ExternalLink className={className} />;
  }
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
          <LinkIcon type={l.type} className="h-3.5 w-3.5" />
          {l.label?.trim() || linkLabel(l.type)}
        </a>
      ))}
    </div>
  );
}
