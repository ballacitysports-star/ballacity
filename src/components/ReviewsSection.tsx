import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import {
  Star,
  MessageSquarePlus,
  ThumbsUp,
  Flag,
  ShieldCheck,
  Lock,
  ArrowUpDown,
} from "lucide-react";
import {
  CRITERIA,
  REVIEWER_META,
  computeReputation,
  type ReviewerKind,
  type Review,
  type RevieweeKind,
} from "@/lib/reviews";
import {
  useMarkHelpful,
  useReportReview,
  useReputationInsight,
  useReviewsFor,
} from "@/lib/reviews-db";
import { refreshMyReputationSummary } from "@/lib/reviews.functions";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { ReputationCard } from "@/components/ReputationCard";
import { RatingExplainer } from "@/components/RatingExplainer";
import { MeasuredStats } from "@/components/MeasuredStats";
import {
  ANSWER_LABELS,
  RECOMMEND_COPY,
  RECOMMEND_LABELS,
  REVIEW_QUESTIONS,
  tagLabel,
} from "@/lib/review-questions";
import { useCanReview } from "@/lib/transactions";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Sort = "recent" | "top" | "lowest" | "helpful";

const FILTERS: { key: ReviewerKind | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "player", label: "🏀 Players" },
  { key: "host", label: "🎯 Hosts" },
  { key: "trainer", label: "🧠 Trainers" },
  { key: "team", label: "🛡️ Teams" },
];

const SORTS: { key: Sort; label: string }[] = [
  { key: "recent", label: "Newest" },
  { key: "top", label: "Highest rating" },
  { key: "lowest", label: "Lowest rating" },
  { key: "helpful", label: "Most helpful" },
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

function ReviewCard({ r, index, isOwner }: { r: Review; index: number; isOwner: boolean }) {
  const meta = REVIEWER_META[r.kind];
  const [reported, setReported] = useState(false);
  const [helped, setHelped] = useState(false);
  const markHelpful = useMarkHelpful();
  const reportReview = useReportReview();

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
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-semibold text-sm">{r.reviewerName}</span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 micro-label ${
                meta.color === "lime" ? "bg-lime/15 text-lime" : "bg-coral/15 text-coral"
              }`}
            >
              {meta.emoji} {meta.label}
            </span>
            {r.verified && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-lime/15 px-1.5 py-0.5 text-[9px] font-bold text-lime">
                <ShieldCheck className="h-2.5 w-2.5" /> Verified
              </span>
            )}
            {r.isPrivate && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">
                <Lock className="h-2.5 w-2.5" /> Private
              </span>
            )}
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

      {r.title && (
        <h3 className="mt-3 font-display text-base font-bold leading-tight">{r.title}</h3>
      )}
      <p className="mt-1 text-sm text-foreground/90">{r.body}</p>

      {r.context && <div className="mt-2 micro-label text-muted-foreground">via {r.context}</div>}

      {r.recommend && (
        <div className="mt-2 text-xs">
          <span className="text-muted-foreground">{RECOMMEND_COPY[r.revieweeKind].prompt}</span>{" "}
          <span className={`font-bold ${r.recommend === "no" ? "text-coral" : "text-lime"}`}>
            {RECOMMEND_LABELS[r.recommend]}
          </span>
        </div>
      )}

      {r.tags && r.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {r.tags.map((t) => (
            <span
              key={t}
              className="rounded-full border border-lime/30 bg-lime/10 px-2 py-0.5 text-[10px] font-bold text-lime"
            >
              {tagLabel(r.revieweeKind, t)}
            </span>
          ))}
        </div>
      )}

      {r.answers && Object.keys(r.answers).length > 0 && (
        <details className="mt-3 group">
          <summary className="cursor-pointer micro-label text-muted-foreground hover:text-lime">
            Quick answers ({Object.keys(r.answers).length})
          </summary>
          <ul className="mt-2 space-y-1">
            {REVIEW_QUESTIONS[r.revieweeKind]
              .filter((q) => r.answers?.[q.key])
              .map((q) => (
                <li key={q.key} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="text-foreground/80">{q.label}</span>
                  <span
                    className={`shrink-0 font-bold ${
                      r.answers?.[q.key] === "no" ? "text-coral" : "text-lime"
                    }`}
                  >
                    {ANSWER_LABELS[r.answers![q.key]]}
                  </span>
                </li>
              ))}
          </ul>
        </details>
      )}

      {r.scores && Object.keys(r.scores).length > 0 && (
        <details className="mt-3 group">
          <summary className="cursor-pointer micro-label text-muted-foreground hover:text-lime">
            See breakdown ({Object.keys(r.scores).length})
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {Object.entries(r.scores).map(([k, v]) => (
              <div
                key={k}
                className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-2 py-1"
              >
                <span className="micro-label text-muted-foreground truncate">
                  {CRITERIA[r.revieweeKind]?.find((c) => c.key === k)?.label ?? k}
                </span>
                <span className="font-display text-xs font-bold text-lime">
                  {v}
                  <span className="text-muted-foreground text-[9px]">/5</span>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
        <button
          onClick={() => {
            if (helped) return;
            markHelpful.mutate(r.id, {
              onError: () => {
                setHelped(false);
                toast.error("Sign in to mark reviews helpful.");
              },
            });
            setHelped(true);
          }}
          className={`inline-flex items-center gap-1 text-[11px] font-semibold ${helped ? "text-lime" : "text-muted-foreground"}`}
        >
          <ThumbsUp className="h-3 w-3" /> Helpful · {(r.helpfulCount ?? 0) + (helped ? 1 : 0)}
        </button>
        {!isOwner && (
          <button
            onClick={() => {
              if (reported) return;
              reportReview.mutate(r.id, {
                onSuccess: () => toast.success("Reported anonymously. Our mods will review."),
                onError: () => {
                  setReported(false);
                  toast.error("Sign in to report a review.");
                },
              });
              setReported(true);
            }}
            className={`inline-flex items-center gap-1 text-[11px] font-semibold ${reported ? "text-coral" : "text-muted-foreground"}`}
          >
            <Flag className="h-3 w-3" /> {reported ? "Reported" : "Report"}
          </button>
        )}
      </div>
    </motion.article>
  );
}

export function ReviewsSection({
  revieweeId,
  revieweeKind = "player",
  revieweeName,
  isOwner = false,
}: {
  revieweeId: string;
  revieweeKind?: RevieweeKind;
  revieweeName?: string;
  /** If true, private reviews are visible (only the reviewee sees them). */
  isOwner?: boolean;
}) {
  const all = useReviewsFor(revieweeId);
  const [filter, setFilter] = useState<ReviewerKind | "all">("all");
  const [sort, setSort] = useState<Sort>("recent");

  // Public view hides private + flagged. Reputation always uses public-visible reviews.
  const publicReviews = useMemo(
    () => all.filter((r) => !r.flagged && (isOwner || !r.isPrivate)),
    [all, isOwner],
  );

  const rep = useMemo(() => computeReputation(all, revieweeKind), [all, revieweeKind]);
  const eligible = useCanReview(revieweeId);
  const insight = useReputationInsight(revieweeId, revieweeKind).data ?? null;
  const { user } = useAuth();
  const realId = revieweeId === "me" ? user?.id : revieweeId;
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refreshInsight = async () => {
    setRefreshing(true);
    try {
      await refreshMyReputationSummary({
        data: { revieweeId: realId ?? "", revieweeKind },
      });
      await qc.invalidateQueries({ queryKey: ["reputation-insight"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't refresh the summary");
    } finally {
      setRefreshing(false);
    }
  };

  const list = useMemo(() => {
    let xs = publicReviews;
    if (filter !== "all") xs = xs.filter((r) => r.kind === filter);
    const sorted = [...xs];
    if (sort === "recent") sorted.sort((a, b) => +new Date(b.date) - +new Date(a.date));
    if (sort === "top") sorted.sort((a, b) => b.rating - a.rating);
    if (sort === "lowest") sorted.sort((a, b) => a.rating - b.rating);
    if (sort === "helpful") sorted.sort((a, b) => (b.helpfulCount ?? 0) - (a.helpfulCount ?? 0));
    return sorted;
  }, [publicReviews, filter, sort]);

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="section-eyebrow text-muted-foreground flex items-center gap-1.5">
          <Star className="h-4 w-4" /> Reviews
        </h2>
        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger className="h-8 w-[140px] rounded-full border-border bg-surface text-xs focus:ring-0 focus:ring-offset-0">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.key} value={s.key}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ReputationCard
        rep={rep}
        insight={insight}
        onRefreshInsight={isOwner ? refreshInsight : undefined}
        refreshing={refreshing}
      />
      <MeasuredStats revieweeId={realId} kind={revieweeKind} />
      <RatingExplainer className="mt-3" />

      {/* Prominent write-a-review CTA */}
      <div className="mt-3">
        {eligible ? (
          <Link
            to="/review/new"
            search={{ revieweeId, revieweeKind, revieweeName, kind: "player" } as any}
            className="flex items-center justify-between gap-3 rounded-2xl border border-lime bg-lime/15 px-4 py-3 text-left transition-colors hover:bg-lime/25"
            aria-label={`Write a review${revieweeName ? ` for ${revieweeName}` : ""}`}
          >
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-lime/25 text-lime">
                <MessageSquarePlus className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="font-display text-sm font-bold text-lime">
                  Write a review{revieweeName ? ` for ${revieweeName}` : ""}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Rate your experience and help others in the community.
                </div>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-lime px-3 py-1 text-[11px] font-bold text-background">
              Start
            </span>
          </Link>
        ) : (
          <div
            className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-surface/60 px-4 py-3"
            role="note"
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
              <Lock className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="font-display text-sm font-bold">Reviews are verified only</div>
              <div className="text-[11px] text-muted-foreground">
                You can write a review after a completed game, training, or event together.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Reviewer-kind filter chips */}
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

      {/* Sort */}
      <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <span className="shrink-0 inline-flex items-center gap-1 micro-label text-muted-foreground">
          <ArrowUpDown className="h-3 w-3" /> Sort
        </span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSort(s.key)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold border ${
              sort === s.key
                ? "border-coral bg-coral/15 text-coral"
                : "border-border bg-surface text-muted-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <PaginatedList list={list} isOwner={isOwner} />
    </div>
  );
}

const PAGE_SIZE = 8;

function PaginatedList({ list, isOwner }: { list: Review[]; isOwner: boolean }) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset when the underlying list changes (filter/sort/data).
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [list]);

  useEffect(() => {
    if (visible >= list.length) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible((v) => Math.min(v + PAGE_SIZE, list.length));
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, list.length]);

  if (list.length === 0) {
    return (
      <div className="mt-3 rounded-2xl border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-muted-foreground">
        No reviews in this view yet.
      </div>
    );
  }

  const shown = list.slice(0, visible);
  const remaining = list.length - visible;

  return (
    <div className="mt-3 space-y-3">
      {shown.map((r, i) => (
        <ReviewCard key={r.id} r={r} index={i} isOwner={isOwner} />
      ))}
      {remaining > 0 && (
        <div ref={sentinelRef} className="flex flex-col items-center gap-2 pt-2">
          <button
            onClick={() => setVisible((v) => Math.min(v + PAGE_SIZE, list.length))}
            className="rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-lime hover:border-lime"
          >
            Load {Math.min(PAGE_SIZE, remaining)} more
          </button>
          <span className="micro-label text-muted-foreground">
            Showing {visible} of {list.length}
          </span>
        </div>
      )}
    </div>
  );
}
