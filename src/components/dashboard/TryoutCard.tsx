import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarClock, ShieldCheck } from "lucide-react";
import { ResponsiveAvatar } from "@/components/ResponsiveImage";
import {
  TRYOUT_KIND_LABEL,
  tryoutAgeDivision,
  tryoutPriceLabel,
  tryoutSpotsLeft,
  tryoutStatusLine,
  tryoutWhenLine,
} from "@/lib/curated-dashboard";
import type { TryoutListing } from "@/lib/tryouts.functions";

/** Team crest: the team's photo when it has one, else its initials. */
function TeamCrest({ name, avatar }: { name: string; avatar: string | null }) {
  const [failed, setFailed] = useState(false);
  const isUrl = !!avatar && /^(https?:|data:|blob:)/.test(avatar);
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg bg-lime/15 text-[10px] font-bold text-lime">
      {isUrl && !failed ? (
        <ResponsiveAvatar
          src={avatar}
          size={28}
          alt=""
          className="h-full w-full object-cover"
          onLoadError={() => setFailed(true)}
        />
      ) : (
        (name || "?").slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

export function TryoutCard({
  t,
  onApply,
}: {
  t: TryoutListing;
  onApply: (t: TryoutListing) => void;
}) {
  const full = tryoutSpotsLeft(t) === 0;
  return (
    <div className="flex w-full flex-col gap-2.5 rounded-2xl border border-border bg-surface p-3.5">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="rounded-full bg-lime/15 px-2 py-0.5 font-bold text-lime">
            {TRYOUT_KIND_LABEL[t.kind]}
          </span>
          <span className="truncate rounded-full border border-border px-2 py-0.5 font-semibold">
            {tryoutAgeDivision(t)}
          </span>
        </span>
        <span className="shrink-0 font-semibold text-muted-foreground">
          {tryoutPriceLabel(t.price)}
        </span>
      </div>

      <div className="min-w-0">
        <h3 className="line-clamp-2 font-display text-base font-bold leading-tight">
          <Link to="/tryouts/$postId" params={{ postId: t.id }} className="hover:underline">
            {t.title}
          </Link>
        </h3>
        <Link
          to="/teams/$teamId"
          params={{ teamId: t.teamId }}
          className="mt-1.5 flex min-w-0 items-center gap-2 text-sm font-semibold hover:underline"
        >
          <TeamCrest name={t.teamName} avatar={t.teamAvatar} />
          <span className="truncate">{t.teamName}</span>
          {t.teamVerified && (
            <ShieldCheck className="h-4 w-4 shrink-0 text-lime" aria-label="Verified team" />
          )}
        </Link>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="flex items-start gap-1.5" suppressHydrationWarning>
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime" />
          <span>{tryoutWhenLine(t)}</span>
        </p>
        <p className="font-semibold text-foreground">{tryoutStatusLine(t, t.waiverRequired)}</p>
      </div>

      <button
        type="button"
        disabled={full}
        onClick={() => onApply(t)}
        className="mt-auto inline-flex min-h-11 w-full items-center justify-center rounded-full bg-lime-gradient px-4 text-sm font-bold text-primary-foreground glow-lime disabled:border disabled:border-border disabled:bg-none disabled:bg-background disabled:text-muted-foreground disabled:shadow-none"
      >
        {full ? "Full" : "RSVP / Apply"}
      </button>
    </div>
  );
}
