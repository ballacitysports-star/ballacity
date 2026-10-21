import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Star, Check, Lock, Globe, ShieldCheck } from "lucide-react";
import { REVIEWEE_META, type ReviewerKind, type RevieweeKind } from "@/lib/reviews";
import {
  ANSWER_LABELS,
  ANSWER_VALUES,
  MAX_TAGS,
  PRAISE_TAGS,
  RECOMMEND_COPY,
  RECOMMEND_LABELS,
  RECOMMEND_VALUES,
  REVIEW_QUESTIONS,
  type Answer,
  type Recommend,
} from "@/lib/review-questions";
import { useTransactionsWith } from "@/lib/transactions";
import { useSubmitReview } from "@/lib/reviews-db";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { suggestReviewText } from "@/lib/reviews.functions";
import { submitSkillVote } from "@/lib/skill.functions";

type Search = {
  revieweeId?: string;
  revieweeKind?: RevieweeKind;
  revieweeName?: string;
  kind?: ReviewerKind;
  context?: string;
};

const isKind = (v: unknown): v is ReviewerKind =>
  v === "player" || v === "trainer" || v === "team" || v === "host";

export const Route = createFileRoute("/review/new")({
  head: () =>
    pageHead({
      title: "Write a review — BallaCity",
      description: "Rate and review a player, team, trainer, or gym you played with.",
      noindex: true,
    }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    revieweeId: typeof s.revieweeId === "string" ? s.revieweeId : "me",
    revieweeKind: isKind(s.revieweeKind) ? s.revieweeKind : "player",
    revieweeName: typeof s.revieweeName === "string" ? s.revieweeName : undefined,
    kind: isKind(s.kind) ? s.kind : "player",
    context: typeof s.context === "string" ? s.context : undefined,
  }),
  component: ReviewNew,
});

function ReviewNew() {
  const search = Route.useSearch();
  const nav = useNavigate();
  const revieweeKind: RevieweeKind = search.revieweeKind ?? "player";
  // The reviewer's role (player, or host of the game being reviewed) is
  // decided by the server from the shared activity, never picked here.
  const kind: ReviewerKind = "player";
  const [rating, setRating] = useState(0); // no default: an unpicked rating anchors people
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [recommend, setRecommend] = useState<Recommend | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [skillVote, setSkillVote] = useState<-1 | 0 | 1 | null>(null);
  const [pickedGame, setPickedGame] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);

  const revieweeMeta = REVIEWEE_META[revieweeKind];

  const questions = REVIEW_QUESTIONS[revieweeKind];
  const tagOptions = PRAISE_TAGS[revieweeKind];
  const sharedTxns = useTransactionsWith(search.revieweeId ?? "");
  const eligible = sharedTxns.length > 0;
  const verified = eligible;
  // Game reviews are one per game; default to the most recent one.
  const selected = sharedTxns.find((t) => t.gameId === pickedGame) ?? sharedTxns[0] ?? null;
  const submitReview = useSubmitReview();
  const canSubmit =
    eligible &&
    body.trim().length >= 8 &&
    rating > 0 &&
    recommend !== null &&
    !submitReview.isPending;
  const toggleTag = (key: string) =>
    setTags((cur) =>
      cur.includes(key)
        ? cur.filter((k) => k !== key)
        : cur.length >= MAX_TAGS
          ? cur
          : [...cur, key],
    );

  const goBack = () => {
    if (revieweeKind === "team" || revieweeKind === "trainer") {
      nav({ to: "/teams/$teamId", params: { teamId: search.revieweeId ?? "" } });
    } else {
      nav({ to: "/profile" });
    }
  };

  const draftWithAi = async () => {
    setDrafting(true);
    try {
      const res = await suggestReviewText({
        data: {
          revieweeKind,
          rating,
          highlights: tags.map((k) => tagOptions.find((t) => t.key === k)?.label ?? k),
          context: selected?.context ?? null,
        },
      });
      setBody(res.draft);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't draft that right now");
    } finally {
      setDrafting(false);
    }
  };

  const submit = () => {
    if (!canSubmit || !selected) return;
    submitReview.mutate(
      {
        kind,
        revieweeKind,
        revieweeId: search.revieweeId ?? "",
        revieweeName: selected.counterpartyName || (search.revieweeName ?? ""),
        gameId: selected.gameId,
        rating,
        scores: {},
        recommend: recommend as Recommend,
        answers,
        tags,
        title,
        body,
        isPrivate,
      },
      {
        onSuccess: () => {
          if (skillVote !== null && selected?.gameId && revieweeKind === "player") {
            void submitSkillVote({
              data: {
                gameId: selected.gameId,
                subjectId: search.revieweeId ?? "",
                vote: skillVote,
              },
            }).catch(() => undefined);
          }
          toast.success(isPrivate ? "Private feedback sent" : "Review posted");
          goBack();
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't post review"),
      },
    );
  };

  const back = goBack;

  return (
    <div className="page-shell-narrow pb-32">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-background/80 px-4 py-3 backdrop-blur">
        <button
          onClick={back}
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="bar-title">Write a review</h1>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="inline-flex items-center gap-1 rounded-full bg-lime-gradient px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-40"
        >
          <Check className="h-4 w-4" /> Post
        </button>
      </header>

      <div className="px-4 space-y-5">
        {/* Reviewee summary */}
        <div className="rounded-2xl border border-border bg-surface p-3 flex items-center gap-3">
          <div className="text-2xl">{revieweeMeta.emoji}</div>
          <div className="min-w-0 flex-1">
            <div className="micro-label text-muted-foreground">
              Reviewing {revieweeMeta.label.toLowerCase()}
            </div>
            <div className="font-semibold truncate">
              {search.revieweeName ?? search.revieweeId ?? "Unknown"}
            </div>
          </div>
          {verified && (
            <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
              <ShieldCheck className="h-3 w-3" /> Verified
            </span>
          )}
        </div>

        {/* Eligibility gate: only allow reviews between users who've closed a shared transaction */}
        {!eligible ? (
          <div className="rounded-2xl border border-coral/40 bg-coral/10 p-4 text-sm">
            <div className="flex items-center gap-2 font-bold text-coral">
              <Lock className="h-4 w-4" /> Reviews are verified-only
            </div>
            <p className="mt-2 text-foreground/80">
              You can review {search.revieweeName ?? "this user"} within 14 days of a game you both
              played, after a training session, or as a team member. Nothing shared yet, or the
              window has closed.
            </p>
            <Link
              to="/profile"
              className="mt-3 inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-bold"
            >
              Back to profile
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-lime/30 bg-lime/10 p-3 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-lime">
              <ShieldCheck className="h-3.5 w-3.5" /> Verified transaction
            </div>
            <p className="mt-1 text-foreground/80">
              {sharedTxns.length === 1
                ? `Based on: ${sharedTxns[0].context}`
                : "Pick which shared activity this review is about:"}
            </p>
            {sharedTxns.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sharedTxns.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setPickedGame(t.gameId)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                      selected?.id === t.id
                        ? "border-lime bg-lime/20 text-foreground"
                        : "border-border bg-surface text-muted-foreground"
                    }`}
                  >
                    {t.context}
                  </button>
                ))}
              </div>
            )}
            {selected?.closesAt && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Open until {new Date(selected.closesAt).toLocaleDateString()}.
              </p>
            )}
          </div>
        )}

        {/* Star rating */}
        <section>
          <h2 className="font-display section-eyebrow text-muted-foreground mb-2">Overall</h2>
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
            <span
              className={`ml-2 font-display font-bold ${rating ? "text-2xl" : "text-sm text-muted-foreground"}`}
            >
              {rating || "Tap to rate"}
            </span>
          </div>
        </section>

        {/* Headline question */}
        <section>
          <h2 className="font-display section-eyebrow text-muted-foreground mb-2">
            {RECOMMEND_COPY[revieweeKind].prompt}
          </h2>
          <div
            className="grid grid-cols-3 gap-2"
            role="group"
            aria-label="Would you do this again?"
          >
            {RECOMMEND_VALUES.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={recommend === v}
                onClick={() => setRecommend(v)}
                className={`rounded-2xl border px-3 py-3 text-sm font-semibold ${
                  recommend === v
                    ? v === "no"
                      ? "border-coral bg-coral/10 text-coral"
                      : "border-lime bg-lime/10 text-foreground"
                    : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {RECOMMEND_LABELS[v]}
              </button>
            ))}
          </div>
        </section>

        {/* Quick behaviour questions */}
        <section>
          <h2 className="font-display section-eyebrow text-muted-foreground mb-1">
            Quick questions <span className="normal-case text-[10px]">(optional)</span>
          </h2>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Skip any you didn't notice. Showing up and being on time are tracked automatically.
          </p>
          <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            {questions.map((q) => (
              <div key={q.key}>
                <div className="text-sm font-semibold">{q.label}</div>
                <div className="mt-1.5 flex gap-1.5" role="group" aria-label={q.label}>
                  {ANSWER_VALUES.map((a) => (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={answers[q.key] === a}
                      onClick={() =>
                        setAnswers((cur) => {
                          const next = { ...cur };
                          if (cur[q.key] === a) delete next[q.key];
                          else next[q.key] = a;
                          return next;
                        })
                      }
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                        answers[q.key] === a
                          ? a === "no"
                            ? "border-coral bg-coral/10 text-coral"
                            : "border-lime bg-lime/15 text-foreground"
                          : "border-border bg-background text-muted-foreground"
                      }`}
                    >
                      {ANSWER_LABELS[a]}
                    </button>
                  ))}
                </div>
                {q.safety && answers[q.key] === "no" && (
                  <p className="mt-1.5 text-[11px] text-coral">
                    Because this is about safety, a "No" is also sent privately to our moderators.
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Praise tags */}
        <section>
          <h2 className="font-display section-eyebrow text-muted-foreground mb-1">
            What stood out?{" "}
            <span className="normal-case text-[10px]">(optional · up to {MAX_TAGS})</span>
          </h2>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Praise tags">
            {tagOptions.map((t) => {
              const on = tags.includes(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && tags.length >= MAX_TAGS}
                  onClick={() => toggleTag(t.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
                    on
                      ? "border-lime bg-lime/20 text-foreground"
                      : "border-border bg-surface text-muted-foreground"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Title */}
        <section>
          <label className="font-display section-eyebrow text-muted-foreground">
            Headline (optional)
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What stood out in one line"
            maxLength={80}
            className="mt-2 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
          />
        </section>

        {/* Body */}
        <section>
          <label className="font-display section-eyebrow text-muted-foreground">
            Tell people more
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Specifics help. How did they play, coach, host, or organize?"
            rows={5}
            maxLength={600}
            className="mt-2 w-full resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={draftWithAi}
              disabled={drafting || tags.length === 0}
              className="inline-flex items-center gap-1 rounded-full border border-lime/40 px-3 py-1.5 text-xs font-bold text-lime disabled:opacity-40"
            >
              <Sparkles className="h-3 w-3" /> {drafting ? "Drafting…" : "Draft with AI"}
            </button>
            <span className="text-[10px] text-muted-foreground">
              {tags.length === 0
                ? "Pick a few tags above first — AI only uses the points you tapped."
                : "AI only uses the tags you picked. Edit it so it sounds like you."}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>AI moderation checks every review before it posts.</span>
            <span>{body.length} / 600</span>
          </div>
        </section>

        {/* Skill check (optional, game reviews of players) */}
        {revieweeKind === "player" && selected?.gameId && selected.sport && (
          <section>
            <h2 className="font-display section-eyebrow text-muted-foreground mb-1">
              Skill check <span className="normal-case text-[10px]">(optional · anonymous)</span>
            </h2>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Compared with the level of this {selected.sport} game, how did they play?
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  [-1, "Below"],
                  [0, "About right"],
                  [1, "Above"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSkillVote((cur) => (cur === v ? null : v))}
                  className={`rounded-2xl border px-3 py-2.5 text-xs font-semibold ${
                    skillVote === v
                      ? "border-lime bg-lime/10 text-foreground"
                      : "border-border bg-surface text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Public / private */}
        <section>
          <h2 className="font-display section-eyebrow text-muted-foreground mb-2">Visibility</h2>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setIsPrivate(false)}
              className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-sm font-semibold ${
                !isPrivate
                  ? "border-lime bg-lime/10"
                  : "border-border bg-surface text-muted-foreground"
              }`}
            >
              <Globe className="h-4 w-4" /> Public
            </button>
            <button
              onClick={() => setIsPrivate(true)}
              className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-sm font-semibold ${
                isPrivate
                  ? "border-coral bg-coral/10 text-coral"
                  : "border-border bg-surface text-muted-foreground"
              }`}
            >
              <Lock className="h-4 w-4" /> Private to them
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {isPrivate
              ? "Only the recipient sees this. Doesn't affect public reputation."
              : "Counts toward reputation score and is visible on their profile."}
          </p>
        </section>

        <Link to="/profile" className="block text-center text-xs text-muted-foreground py-2">
          Cancel
        </Link>
      </div>
    </div>
  );
}
