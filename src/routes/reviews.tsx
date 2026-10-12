import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { motion } from "framer-motion";
import { Trophy, ArrowUpDown } from "lucide-react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import {
  computeReputation,
  REVIEWEE_META,
  type RevieweeKind,
} from "@/lib/reviews";
import { useReviewBoard, useReviewsFor } from "@/lib/reviews-db";
import { ReputationBadge } from "@/components/ReputationBadge";
import { useMemo } from "react";

export const Route = createFileRoute("/reviews")({
  head: () =>
    pageHead({
      title: "Reviews & reputation — BallaCity",
      description:
        "Read and manage reviews for players, teams, trainers, and gyms across BallaCity.",
      noindex: true,
    }),
  // URL-persisted filter + sort so refresh/share preserves the view.
  validateSearch: zodValidator(
    z.object({
      filter: fallback(z.string(), "").default(""),
      sort: fallback(z.string(), "").default(""),
    }),
  ),
  component: ReviewsDashboard,
});

type Sort = "trust" | "rating" | "count";

const KINDS: { key: RevieweeKind | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "player", label: "🏀 Players" },
  { key: "trainer", label: "🧠 Trainers" },
  { key: "team", label: "🛡️ Teams" },
  { key: "host", label: "🎯 Hosts" },
];

const SORTS: { key: Sort; label: string }[] = [
  { key: "trust", label: "Trust score" },
  { key: "rating", label: "Star rating" },
  { key: "count", label: "Review count" },
];

function RevieweeCard({
  revieweeId,
  revieweeKind,
  revieweeName,
  index,
}: {
  revieweeId: string;
  revieweeKind: RevieweeKind;
  revieweeName: string;
  index: number;
}) {
  const all = useReviewsFor(revieweeId);
  const rep = useMemo(() => computeReputation(all, revieweeKind), [all, revieweeKind]);
  const meta = REVIEWEE_META[revieweeKind];

  const linkTo =
    revieweeKind === "player"
      ? "/profile"
      : revieweeKind === "host"
        ? `/games/g1`
        : `/teams/${revieweeId}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Link to={linkTo} className="block">
        <div className="rounded-3xl border border-border bg-surface p-4 hover:border-lime/40 transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-secondary font-display text-sm font-bold">
              {meta.emoji}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm truncate">{revieweeName}</div>
              <div className="micro-label text-muted-foreground">
                {meta.label}
              </div>
            </div>
          </div>
          <ReputationBadge rep={rep} compact />
        </div>
      </Link>
    </motion.div>
  );
}

function ReviewsDashboard() {
  const reviewees = useReviewBoard();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/reviews" });
  const filter: RevieweeKind | "all" = (search.filter || "all") as RevieweeKind | "all";
  const sort: Sort = (search.sort as Sort) || "trust";
  const setFilter = (v: RevieweeKind | "all") =>
    navigate({ search: (p: any) => ({ ...p, filter: v === "all" ? "" : v }), replace: true });
  const setSort = (v: Sort) =>
    navigate({ search: (p: any) => ({ ...p, sort: v === "trust" ? "" : v }), replace: true });

  const filtered = useMemo(() => {
    let xs = reviewees;
    if (filter !== "all") xs = xs.filter((r) => r.revieweeKind === filter);
    return xs;
  }, [reviewees, filter]);

  const sorted = useMemo(() => {
    const withRep = filtered.map((r) => ({
      ...r,
      rep: computeReputation(r.reviews, r.revieweeKind),
    }));
    if (sort === "trust") withRep.sort((a, b) => b.rep.trustScore - a.rep.trustScore);
    if (sort === "rating") withRep.sort((a, b) => b.rep.adjustedAvg - a.rep.adjustedAvg);
    if (sort === "count") withRep.sort((a, b) => b.rep.count - a.rep.count);
    return withRep;
  }, [filtered, sort]);

  return (
    <div className="page-shell-narrow pt-6 pb-32">
      <div className="flex items-center gap-2 mb-1">
        <Trophy className="h-5 w-5 text-lime" />
        <h1 className="page-title">Reviews Hub</h1>
      </div>
      <p className="mb-5 page-subtitle">
        Trust scores, top strengths, and AI insights for everyone on BallaCity.
      </p>

      {/* Kind filter */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 mb-2">
        {KINDS.map((k) => (
          <button
            key={k.key}
            onClick={() => setFilter(k.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition-all ${
              filter === k.key
                ? "border-lime bg-lime/15 text-lime"
                : "border-border bg-surface text-muted-foreground"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 mb-4">
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

      {/* Grid */}
      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-muted-foreground">
          No reviews in this view yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {sorted.map((r, i) => (
            <RevieweeCard
              key={r.revieweeId}
              revieweeId={r.revieweeId}
              revieweeKind={r.revieweeKind}
              revieweeName={r.revieweeName}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}
