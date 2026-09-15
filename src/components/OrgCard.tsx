import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ShieldCheck, Star, Users } from "lucide-react";
import type { Org } from "@/lib/sample-data";
import { ResponsiveAvatar, ResponsiveImage } from "@/components/ResponsiveImage";

export function OrgCard({
  org,
  index = 0,
  search,
}: {
  org: Org;
  index?: number;
  search?: Record<string, unknown>;
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => {
    setAvatarFailed(false);
  }, [org.avatar]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Link
        to={org.kind === "coach" ? "/trainers/$trainerId" : "/teams/$teamId"}
        params={org.kind === "coach" ? { trainerId: org.id } : { teamId: org.id }}
        search={search as never}
        className="group block overflow-hidden rounded-3xl border border-border bg-surface transition-all hover:border-lime/40 hover:-translate-y-0.5"
      >
        <div className="relative h-28 overflow-hidden">
          <ResponsiveImage
            src={org.cover}
            alt=""
            aspect={16 / 9}
            widths={[320, 480, 640, 960]}
            sizes="(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw"
            baseWidth={640}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent" />
          <span className="absolute top-3 left-3 rounded-full bg-background/70 backdrop-blur px-2.5 py-1 micro-label">
            {org.kind === "team" ? "Team" : "Trainer"}
          </span>
        </div>

        <div className="p-4 -mt-10 relative">
          {(() => {
            const a = org.avatar || "";
            const isUrl = /^(https?:|data:|blob:)/.test(a);
            if (isUrl && !avatarFailed) {
              return (
                <div className="h-16 w-16 overflow-hidden rounded-2xl border-4 border-surface bg-surface">
                  <ResponsiveAvatar
                    src={a}
                    size={64}
                    alt=""
                    className="h-full w-full object-cover"
                    onLoadError={() => setAvatarFailed(true)}
                  />
                </div>
              );
            }
            // `a` is only safe to print directly when it was already a
            // short label (not a URL) — a failed photo falls back to the
            // org name's initials instead of showing the raw image URL.
            const label = isUrl ? org.name.slice(0, 2).toUpperCase() : a;
            return (
              <div
                className="grid h-16 w-16 place-items-center rounded-2xl border-4 border-surface font-display text-xl font-bold text-primary-foreground"
                style={{ background: `linear-gradient(135deg, ${org.accent}, ${org.accent}aa)` }}
              >
                {label}
              </div>
            );
          })()}

          <div className="mt-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-display text-lg font-bold leading-tight flex items-center gap-1.5 truncate">
                {org.name}
                {org.verified && <ShieldCheck className="h-4 w-4 text-lime shrink-0" />}
              </h3>
              <div className="text-xs text-muted-foreground truncate">
                {org.handle} · {org.city}
              </div>
            </div>
          </div>

          <p className="mt-2 text-sm text-foreground/85 line-clamp-2">{org.tagline}</p>

          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5 text-lime" />
              {org.followers.toLocaleString()}
            </span>
            {org.kind === "coach" && org.rating && (
              <span className="inline-flex items-center gap-1">
                <Star className="h-3.5 w-3.5 text-coral" />
                {org.rating.toFixed(1)} · {org.reviews}
              </span>
            )}
            {org.kind === "team" && org.record && (
              <span className="text-foreground font-semibold">
                {org.record.w}–{org.record.l}
              </span>
            )}
            <span className="ml-auto inline-flex flex-wrap gap-1">
              {org.sports.slice(0, 2).map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-foreground"
                >
                  {s}
                </span>
              ))}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
