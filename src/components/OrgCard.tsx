import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ShieldCheck, Star, Users } from "lucide-react";
import type { Org } from "@/lib/sample-data";

export function OrgCard({
  org,
  index = 0,
  search,
}: {
  org: Org;
  index?: number;
  search?: Record<string, unknown>;
}) {
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
          <img
            src={org.cover}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent" />
          <span className="absolute top-3 left-3 rounded-full bg-background/70 backdrop-blur px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">
            {org.kind === "team" ? "Team" : "Trainer"}
          </span>
        </div>

        <div className="p-4 -mt-10 relative">
          {(() => {
            const a = org.avatar || "";
            const isUrl = /^(https?:|data:|blob:)/.test(a);
            if (isUrl) {
              return (
                <div className="h-16 w-16 overflow-hidden rounded-2xl border-4 border-surface bg-surface">
                  <img src={a} alt="" className="h-full w-full object-cover" />
                </div>
              );
            }
            return (
              <div
                className="grid h-16 w-16 place-items-center rounded-2xl border-4 border-surface font-display text-xl font-bold text-primary-foreground"
                style={{ background: `linear-gradient(135deg, ${org.accent}, ${org.accent}aa)` }}
              >
                {a}
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
