import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Star, Check } from "lucide-react";
import { addReview, REVIEWER_META, type ReviewerKind } from "@/lib/reviews";
import { ME } from "@/lib/sample-data";
import { toast } from "sonner";

type Search = {
  revieweeId?: string;
  kind?: ReviewerKind;
  context?: string;
};

export const Route = createFileRoute("/review/new")({
  head: () => ({ meta: [{ title: "Write a review — OpenRun" }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    revieweeId: typeof s.revieweeId === "string" ? s.revieweeId : "me",
    kind:
      s.kind === "player" || s.kind === "trainer" || s.kind === "team" || s.kind === "host"
        ? s.kind
        : "player",
    context: typeof s.context === "string" ? s.context : undefined,
  }),
  component: ReviewNew,
});

const KINDS: ReviewerKind[] = ["player", "trainer", "team", "host"];

function ReviewNew() {
  const search = Route.useSearch();
  const nav = useNavigate();
  const [kind, setKind] = useState<ReviewerKind>(search.kind ?? "player");
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [context, setContext] = useState(search.context ?? "");
  const [scores, setScores] = useState<Record<string, number>>({});

  const meta = REVIEWER_META[kind];

  const canSubmit = body.trim().length >= 8 && rating > 0;

  const submit = () => {
    if (!canSubmit) return;
    addReview({
      kind,
      revieweeId: search.revieweeId ?? "me",
      reviewerName: ME.name,
      reviewerHandle: ME.username,
      reviewerAvatar: ME.avatar,
      reviewerSubtitle: `${meta.label} · ${ME.city}`,
      rating,
      scores,
      title: title.trim() || undefined,
      body: body.trim(),
      context: context.trim() || undefined,
    });
    toast.success("Review posted");
    nav({ to: "/profile" });
  };

  return (
    <div className="mx-auto max-w-md pb-32">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-background/80 px-4 py-3 backdrop-blur">
        <button
          onClick={() => nav({ to: "/profile" })}
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="font-display text-lg font-bold">Write a review</h1>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="inline-flex items-center gap-1 rounded-full bg-lime-gradient px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-40"
        >
          <Check className="h-4 w-4" /> Post
        </button>
      </header>

      <div className="px-4 space-y-5">
        {/* Reviewer role */}
        <section>
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            I'm reviewing as
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => {
              const m = REVIEWER_META[k];
              const active = kind === k;
              return (
                <button
                  key={k}
                  onClick={() => {
                    setKind(k);
                    setScores({});
                  }}
                  className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-sm font-semibold transition-all ${
                    active
                      ? "border-lime bg-lime/10 text-foreground"
                      : "border-border bg-surface text-muted-foreground"
                  }`}
                >
                  <span className="text-base">{m.emoji}</span>
                  {m.label} → Player
                </button>
              );
            })}
          </div>
        </section>

        {/* Star rating */}
        <section>
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Overall
          </h2>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <motion.button
                key={i}
                whileTap={{ scale: 0.85 }}
                onClick={() => setRating(i)}
                aria-label={`${i} stars`}
              >
                <Star
                  className={`h-9 w-9 ${
                    i <= rating ? "fill-lime text-lime" : "text-muted-foreground/40"
                  }`}
                />
              </motion.button>
            ))}
            <span className="ml-2 font-display text-2xl font-bold">{rating}</span>
          </div>
        </section>

        {/* Sub-scores */}
        <section>
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Breakdown
          </h2>
          <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            {meta.subFields.map((f) => {
              const value = scores[f] ?? 4;
              return (
                <div key={f}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="capitalize font-semibold">{f}</span>
                    <span className="text-lime font-bold">{value} / 5</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={value}
                    onChange={(e) =>
                      setScores((s) => ({ ...s, [f]: Number(e.target.value) }))
                    }
                    className="mt-1 w-full accent-lime"
                  />
                </div>
              );
            })}
          </div>
        </section>

        {/* Title */}
        <section>
          <label className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Headline (optional)
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Glue guy on any team"
            maxLength={80}
            className="mt-2 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
          />
        </section>

        {/* Body */}
        <section>
          <label className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground">
            What stood out?
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Specifics help. How did they play, communicate, show up?"
            rows={5}
            maxLength={600}
            className="mt-2 w-full resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
          />
          <div className="mt-1 text-right text-[10px] text-muted-foreground">
            {body.length} / 600
          </div>
        </section>

        {/* Context */}
        <section>
          <label className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Context (optional)
          </label>
          <input
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Friday Night Run · 5v5"
            maxLength={80}
            className="mt-2 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
          />
        </section>

        <Link
          to="/profile"
          className="block text-center text-xs text-muted-foreground py-2"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}
