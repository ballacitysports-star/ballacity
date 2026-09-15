import { useMemo, useState } from "react";
import { Star, ShieldCheck, ThumbsUp, EyeOff, Eye, Pencil, Trash2, Flag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { UserAvatar } from "@/components/UserAvatar";
import { ReportUserDialog } from "@/components/ReportUserDialog";
import {
  summarizeGymReviews,
  useGymReviewActions,
  useGymReviews,
  type GymReview,
} from "@/lib/gym-reviews";

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={
            i <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
          }
        />
      ))}
    </span>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          aria-label={`${i} star${i === 1 ? "" : "s"}`}
          onClick={() => onChange(i)}
          className="p-0.5"
        >
          <Star
            className={`h-6 w-6 ${i <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`}
          />
        </button>
      ))}
    </div>
  );
}

/** Reviews + star ratings for a gym listing, with verified-visit badges and owner moderation. */
export function GymReviews({
  orgId,
  orgName,
  isAdmin,
}: {
  orgId: string;
  orgName: string;
  isAdmin: boolean;
}) {
  const { user } = useAuth();
  const { data, isLoading } = useGymReviews(orgId);
  const { submit, remove, toggleHelpful, moderate } = useGymReviewActions(orgId, orgName);

  const reviews = useMemo(() => data ?? [], [data]);
  const summary = summarizeGymReviews(reviews);
  const mine = user ? (reviews.find((r) => r.reviewer_id === user.id) ?? null) : null;

  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reportTarget, setReportTarget] = useState<GymReview | null>(null);

  function startEdit(r: GymReview | null) {
    setRating(r?.rating ?? 0);
    setTitle(r?.title ?? "");
    setBody(r?.body ?? "");
    setEditing(true);
  }

  async function save() {
    try {
      await submit.mutateAsync({ id: mine?.id, rating, title, body });
      toast.success(mine ? "Review updated" : "Thanks for your review");
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save review");
    }
  }

  const visible = isAdmin
    ? reviews
    : reviews.filter((r) => !r.flagged || r.reviewer_id === user?.id);

  return (
    <section className="rounded-2xl border border-border/60 bg-surface p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="section-title flex items-center gap-2">
          <Star className="h-4 w-4 text-lime" /> Ratings & reviews
        </h2>
        {user && !mine && !editing && (
          <Button size="sm" variant="outline" onClick={() => startEdit(null)}>
            Write a review
          </Button>
        )}
      </div>

      {summary.count > 0 ? (
        <div className="flex items-center gap-5">
          <div className="text-center">
            <div className="font-display text-3xl font-bold leading-none">
              {summary.avg.toFixed(1)}
            </div>
            <Stars value={summary.avg} />
            <div className="mt-1 text-[11px] text-muted-foreground">
              {summary.count} review{summary.count === 1 ? "" : "s"}
            </div>
          </div>
          <ul className="min-w-0 flex-1 space-y-1">
            {[5, 4, 3, 2, 1].map((star) => {
              const n = summary.distribution[star - 1];
              const pct = summary.count ? (n / summary.count) * 100 : 0;
              return (
                <li
                  key={star}
                  className="flex items-center gap-2 text-[11px] text-muted-foreground"
                >
                  <span className="w-3 tabular-nums">{star}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                    <span
                      className="block h-full rounded-full bg-amber-400"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="w-6 text-right tabular-nums">{n}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        !isLoading && (
          <p className="text-xs text-muted-foreground">
            No reviews yet. Be the first to rate this gym.
          </p>
        )
      )}

      {!user && <p className="text-xs text-muted-foreground">Sign in to leave a review.</p>}

      {editing && (
        <div className="space-y-2 rounded-xl border border-border bg-background p-3">
          <StarPicker value={rating} onChange={setRating} />
          <Input
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
          />
          <Textarea
            value={body}
            maxLength={2000}
            rows={4}
            onChange={(e) => setBody(e.target.value)}
            placeholder="How was the facility, staff, and booking experience?"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{body.trim().length}/2000</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={submit.isPending || rating < 1}>
                {mine ? "Save changes" : "Post review"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ul className="space-y-3">
        {visible.map((r) => {
          const isMine = r.reviewer_id === user?.id;
          return (
            <li
              key={r.id}
              className={`rounded-xl border border-border/60 p-3 ${r.flagged ? "opacity-60" : ""}`}
            >
              <div className="flex items-start gap-2">
                <UserAvatar
                  name={r.reviewer?.display_name ?? "Member"}
                  initials={r.reviewer?.avatar_initials}
                  avatarUrl={r.reviewer?.avatar_url}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold">
                      {r.reviewer?.display_name ?? "Member"}
                    </span>
                    {r.verified && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
                        <ShieldCheck className="h-3 w-3" /> Verified visit
                      </span>
                    )}
                    {r.flagged && (
                      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold text-destructive">
                        Hidden
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Stars value={r.rating} size={12} />
                    <span>{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  {r.title && <p className="mt-1 text-sm font-semibold">{r.title}</p>}
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">{r.body}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      disabled={!user || toggleHelpful.isPending}
                      onClick={() =>
                        toggleHelpful
                          .mutateAsync(r)
                          .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
                      }
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 font-semibold ${
                        r.helpful_by_me
                          ? "border-lime/50 bg-lime/10 text-lime"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      <ThumbsUp className="h-3 w-3" /> Helpful
                      {r.helpful_count ? ` (${r.helpful_count})` : ""}
                    </button>

                    {isMine ? (
                      <>
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 font-semibold text-muted-foreground"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await remove.mutateAsync(r.id);
                              toast.success("Review deleted");
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Failed");
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 font-semibold text-muted-foreground"
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      </>
                    ) : (
                      user && (
                        <button
                          type="button"
                          onClick={() => setReportTarget(r)}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 font-semibold text-muted-foreground"
                        >
                          <Flag className="h-3 w-3" /> Report
                        </button>
                      )
                    )}

                    {isAdmin && !isMine && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await moderate.mutateAsync({ id: r.id, hidden: !r.flagged });
                            toast.success(r.flagged ? "Review restored" : "Review hidden");
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed");
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-semibold text-amber-500"
                      >
                        {r.flagged ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        {r.flagged ? "Unhide" : "Hide"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {reportTarget && (
        <ReportUserDialog
          open
          onOpenChange={(o) => !o && setReportTarget(null)}
          userId={reportTarget.reviewer_id}
          displayName={reportTarget.reviewer?.display_name ?? "this member"}
        />
      )}
    </section>
  );
}
