import { motion } from "framer-motion";
import { Calendar, MapPin, Users, DollarSign, Pin } from "lucide-react";
import { POST_KIND_META, type OrgPost } from "@/lib/sample-data";
import { formatWhen } from "@/lib/format";

export function PostCard({
  post,
  index = 0,
  onClick,
}: {
  post: OrgPost;
  index?: number;
  onClick?: () => void;
}) {
  const meta = POST_KIND_META[post.kind];
  const isEvent = post.kind === "tryout" || post.kind === "pickup" || post.kind === "clinic";
  const accent =
    meta.color === "coral"
      ? "text-coral border-coral/40 bg-coral/10"
      : meta.color === "lime"
        ? "text-lime border-lime/40 bg-lime/10"
        : "text-muted-foreground border-border bg-secondary";

  const fillPct = post.spots ? Math.round((post.spots.taken / post.spots.max) * 100) : 0;
  const spotsLeft = post.spots ? post.spots.max - post.spots.taken : 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`relative rounded-3xl border border-border bg-surface p-4 ${onClick ? "cursor-pointer transition hover:border-lime/40 focus:outline-none focus:ring-2 focus:ring-lime/40" : ""}`}
    >

      {post.pinned && (
        <span className="absolute -top-2 left-4 inline-flex items-center gap-1 rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
          <Pin className="h-3 w-3" /> Pinned
        </span>
      )}

      <div className="flex items-center justify-between mb-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${accent}`}
        >
          <span>{meta.emoji}</span> {meta.label}
        </span>
        <span className="text-[11px] text-muted-foreground">{formatWhen(post.postedAt)}</span>
      </div>

      <h3 className="font-display text-lg font-bold leading-tight">{post.title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground line-clamp-3">{post.body}</p>

      {isEvent && (
        <div className="mt-3 space-y-2.5">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-lime" />
              {formatWhen(post.date)}
            </span>
            {post.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-coral" />
                {post.location}
              </span>
            )}
            {typeof post.price === "number" && (
              <span className="inline-flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5" />
                {post.price === 0 ? "Free" : `$${post.price}`}
              </span>
            )}
          </div>

          {post.spots && (
            <>
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="inline-flex items-center gap-1.5 text-foreground">
                  <Users className="h-3.5 w-3.5 text-lime" />
                  {post.spots.taken}/{post.spots.max} signed up
                </span>
                {spotsLeft > 0 ? (
                  <span className={spotsLeft <= 3 ? "text-coral" : "text-muted-foreground"}>
                    {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left
                  </span>
                ) : (
                  <span className="text-muted-foreground">Waitlist</span>
                )}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${fillPct}%` }}
                  transition={{ duration: 0.7 }}
                  className={`h-full ${spotsLeft <= 3 ? "bg-coral-gradient" : "bg-lime-gradient"}`}
                />
              </div>
            </>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={(e) => e.stopPropagation()}
              className="flex-1 rounded-full bg-lime-gradient py-2.5 text-sm font-bold text-primary-foreground glow-lime"
            >
              {post.kind === "tryout" ? "Apply" : "RSVP"}
            </button>
            <button
              onClick={(e) => e.stopPropagation()}
              className="rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-semibold"
            >
              Share
            </button>
          </div>

        </div>
      )}

      {!isEvent && typeof post.rsvps === "number" && (
        <div className="mt-3 text-xs text-muted-foreground">❤ {post.rsvps} reactions</div>
      )}
    </motion.article>
  );
}
