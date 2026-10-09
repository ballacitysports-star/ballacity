import { useMemo, useState } from "react";
import { Copy, Check, Share2, MapPin, ShieldCheck, Link2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ogImageUrl } from "@/lib/seo";

export type ProfileShareKind = "player" | "team" | "trainer" | "gym";

const KIND_LABEL: Record<ProfileShareKind, string> = {
  player: "BallaCity player",
  team: "BallaCity team",
  trainer: "BallaCity trainer",
  gym: "BallaCity gym",
};

const KIND_TITLE: Record<ProfileShareKind, string> = {
  player: "Share this player",
  team: "Share this team",
  trainer: "Share this trainer",
  gym: "Share this gym",
};

export type ProfileShareData = {
  kind: ProfileShareKind;
  /** Path on the site, e.g. "/players/123" (leading slash). */
  path: string;
  displayName: string;
  username?: string;
  initials: string;
  avatarUrl?: string;
  /** Bio / About text — trimmed into the highlight line. */
  bio?: string;
  city?: string;
  /** Formatted travel radius, e.g. "25 mi". */
  travelRadius?: string;
  sports?: { name: string; level?: string | null }[];
  trustScore?: number;
  /** Star rating out of 5 (teams, trainers, gyms). */
  rating?: number | null;
  reviewCount?: number;
  linkCount?: number;
  /** Extra highlight lines appended below the standard ones. */
  extras?: (string | null | undefined | false)[];
};

function highlightLines(d: ProfileShareData): string[] {
  const out: string[] = [];
  const sports = d.sports ?? [];
  if (sports.length) {
    out.push(
      sports
        .slice(0, 3)
        .map((s) => (s.level ? `${s.name} · ${s.level}` : s.name))
        .join("  •  "),
    );
  }
  if (d.city || d.travelRadius) {
    out.push(
      [d.city || "Anywhere", d.travelRadius ? `travels up to ${d.travelRadius}` : null]
        .filter(Boolean)
        .join(" · "),
    );
  }
  const reviewSuffix = d.reviewCount
    ? ` · ${d.reviewCount} review${d.reviewCount === 1 ? "" : "s"}`
    : "";
  if (d.trustScore != null) {
    out.push(`Trust score ${d.trustScore}${reviewSuffix}`);
  } else if (d.rating != null && d.rating > 0) {
    out.push(`${d.rating.toFixed(1)}★${reviewSuffix}`);
  } else if (d.reviewCount) {
    out.push(`${d.reviewCount} review${d.reviewCount === 1 ? "" : "s"}`);
  }
  for (const extra of d.extras ?? []) if (extra) out.push(extra);
  if (d.linkCount) out.push(`${d.linkCount} link${d.linkCount === 1 ? "" : "s"}`);
  return out;
}

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Share dialog showing a clean BallaCity preview card built from a profile's
 * About-section highlights, with native share / copy-link actions. Works for
 * every profile type (player, team, trainer, gym).
 */
export function ProfileShareCard({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: ProfileShareData;
}) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => highlightLines(data), [data]);
  const bioSnippet = (data.bio ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
  const kindLabel = KIND_LABEL[data.kind];

  const url = typeof window === "undefined" ? data.path : `${window.location.origin}${data.path}`;

  const cardImage = ogImageUrl({
    kind: data.kind === "gym" ? "venue" : data.kind,
    title: data.displayName,
    subtitle: bioSnippet || lines[0] || kindLabel,
    meta: [
      data.sports?.[0]?.name,
      data.city,
      data.trustScore != null
        ? `Trust ${data.trustScore}`
        : data.rating
          ? `${data.rating.toFixed(1)}★`
          : null,
    ],
  });

  const shareText = [data.displayName, bioSnippet, ...lines].filter(Boolean).join("\n");

  const handleShare = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: `${data.displayName} on BallaCity`, text: shareText, url });
        return;
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
    }
    const ok = await copyText(`${shareText}\n${url}`);
    toast[ok ? "success" : "error"](ok ? "Card copied to clipboard" : "Couldn't share this card");
  };

  const handleCopyLink = async () => {
    const ok = await copyText(url);
    if (!ok) {
      toast.error("Couldn't copy the link");
      return;
    }
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{KIND_TITLE[data.kind]}</DialogTitle>
          <DialogDescription>
            A clean BallaCity preview card with the About highlights.
          </DialogDescription>
        </DialogHeader>

        {/* Preview card */}
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="flex items-start gap-3 p-4">
            <Avatar className="h-14 w-14 border border-border">
              {data.avatarUrl && <AvatarImage src={data.avatarUrl} alt={data.displayName} />}
              <AvatarFallback className="text-sm font-bold">{data.initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base font-bold leading-tight">
                {data.displayName}
              </p>
              {data.username && (
                <p className="truncate text-xs text-muted-foreground">{data.username}</p>
              )}
              <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 micro-label text-lime">
                <ShieldCheck className="h-3 w-3" /> {kindLabel}
              </p>
            </div>
          </div>

          {bioSnippet && (
            <p className="px-4 text-sm leading-relaxed text-foreground/90">
              {bioSnippet}
              {(data.bio ?? "").trim().length > 160 ? "…" : ""}
            </p>
          )}

          <ul className="mt-3 space-y-1 px-4 pb-4 text-xs text-muted-foreground">
            {lines.map((l, i) => (
              <li key={i} className="flex items-start gap-1.5">
                {i === 1 ? (
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime" />
                ) : (
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
                )}
                <span>{l}</span>
              </li>
            ))}
            <li className="flex items-start gap-1.5 pt-1">
              <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-all">{url.replace(/^https?:\/\//, "")}</span>
            </li>
          </ul>
        </div>

        <div className="flex gap-2">
          <Button className="flex-1" onClick={handleShare}>
            <Share2 className="mr-1.5 h-4 w-4" /> Share
          </Button>
          <Button variant="secondary" className="flex-1" onClick={handleCopyLink}>
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
            Copy link
          </Button>
        </div>
        <a
          href={cardImage}
          target="_blank"
          rel="noreferrer"
          className="text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Open shareable image
        </a>
      </DialogContent>
    </Dialog>
  );
}
