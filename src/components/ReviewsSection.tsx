import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { Star, MessageSquarePlus } from "lucide-react";
import {
  REVIEWER_META,
  summarizeReviews,
  useReviewsFor,
  type ReviewerKind,
  type Review,
} from "@/lib/reviews";

const FILTERS: { key: ReviewerKind | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "player", label: "🏀 Players" },
  { key: "host", label: "🎯 Hosts" },
  { key: "trainer", label: "🧠 Trainers" },
  { key: "team", label: "🛡️ Teams" },
];

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400_000);
  if (d < 1) return "today";
  if (d === 1) return "1 day ago";
  if (d < 30) return `${d} days ago`;
  const m = Math.floor(d / 30);
  return `${m} mo ago`;
}

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={i <= Math.round(value) ? "fill-lime text-lime" : "text-muted-foreground/40"}
        />
      ))}
    </div>
  );
}

function ReviewCard({ r, index }: { r: Review; index: number }) {
  const meta = REVIEWER_META[r.kind];
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="rounded-3xl border border-border bg-surface p-4"
    >
      <header className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-secondary font-display text-sm font-bold">
          {r.reviewerAvatar}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-sm">{r.reviewerName}</span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                meta.color === "lime"
                  ? "bg-lime/15 text-lime"
                  : "bg-coral/15 text-coral"
              }`}
            >
              {meta.emoji} {meta.label}
            </span>
          </div>
          {r.reviewerSubtitle && (
            <div className="text-xs text-muted-foreground">{r.reviewerSubtitle}</div>
          )}
        </div>
        <div className="text-right">
          <Stars value={r.rating} />
          <div className="mt-0.5 text-[10px] text-muted-foreground">{timeAgo(r.date)}</div>
        </div>
      </header>

      {r.title && <h3 className="mt-3 font-display text-base font-bold leading-tight">{r.title}</h3>}
      <p className="mt-1 text-sm text-foreground/90">{r.body}</p>

      {r.context && (
        <div className="mt-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          via {r.context}
        </div>
      )}

      {r.scores && Object.keys(r.scores).length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {Object.entries(r.scores).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border bg-background/40 p-2 text-center">
              <div className="font-display text-sm font-bold text-lime">{v}<span className="text-muted-foreground text-[10px]">/5</span></div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{k}</div>
            </div>
          ))}
        </div>
      )}
    </motion.article>
  );
}

export function ReviewsSection({ revieweeId }: { revieweeId: string }) {
  const reviews = useReviewsFor(revieweeId);
  const [filter, setFilter] = useState<ReviewerKind | "all">("all");

  const summary = useMemo(() => summarizeReviews(reviews), [reviews]);
  const list = useMemo(
    () => (filter === "all" ? reviews : reviews.filter((r) => r.kind === filter)),
    [reviews, filter],
  );

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Star className="h-4 w-4" /> Reviews
        </h2>
        <Link
          to="/review/new"
          search={{ revieweeId, kind: "player" } as any}
          className="inline-flex items-center gap-1 text-xs font-bold text-lime"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" /> Write
        </Link>
      </div>

      {/* Summary */}
      <div className="rounded-3xl border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <div className="font-display text-3xl font-bold">{summary.avg.toFixed(1)}</div>
          <div>
            <Stars value={summary.avg} size={16} />
            <div className="text-xs text-muted-foreground mt-0.5">
              {summary.count} review{summary.count === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {(["player", "host", "trainer", "team"] as ReviewerKind[]).map((k) => {
            const count = summary.byKind[k] ?? 0;
            const meta = REVIEWER_META[k];
            return (
              <div key={k} className="rounded-xl border border-border bg-background/40 p-2 text-center">
                <div className="text-base leading-none">{meta.emoji}</div>
                <div className="mt-1 font-display text-sm font-bold">{count}</div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{meta.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filter chips */}
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition-all ${
              filter === f.key
                ? "border-lime bg-lime/15 text-lime"
                : "border-border bg-surface text-muted-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-3">
        {list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-muted-foreground">
            No reviews in this category yet.
          </div>
        ) : (
          list.map((r, i) => <ReviewCard key={r.id} r={r} index={i} />)
        )}
      </div>
    </div>
  );
}
