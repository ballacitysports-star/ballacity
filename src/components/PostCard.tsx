import { useState } from "react";
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  MoreHorizontal,
  Calendar,
  MapPin,
  Users,
  DollarSign,
  Pin,
} from "lucide-react";
import { POST_KIND_META, type OrgPost } from "@/lib/sample-data";
import { formatWhen } from "@/lib/format";
import { useNavigate } from "@tanstack/react-router";

/**
 * Instagram-style feed card. Preserves every existing datum on OrgPost
 * (kind badge, event date, location, price, spots, RSVP CTA, pinned) but
 * re-lays them into IG's canonical order: header row, edge-to-edge media
 * area, action row, caption, then event meta.
 *
 * Like/comment/share/save are UI-only affordances that mirror the
 * existing "onClick opens PostDetailsDialog" behavior — they route to
 * the same click handler so no server logic changes.
 */
export function PostCard({
  post,
  index: _index = 0,
  onClick,
}: {
  post: OrgPost;
  index?: number;
  onClick?: () => void;
}) {
  const meta = POST_KIND_META[post.kind];
  const isEvent = post.kind === "tryout" || post.kind === "pickup" || post.kind === "clinic";

  const fillPct = post.spots ? Math.round((post.spots.taken / post.spots.max) * 100) : 0;
  const spotsLeft = post.spots ? post.spots.max - post.spots.taken : 0;

  const navigate = useNavigate();
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const openable = !!onClick;
  const openProps = openable
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick?.();
          }
        },
      }
    : {};

  return (
    <article
      className={`overflow-hidden border-b border-border bg-background ${openable ? "cursor-pointer" : ""}`}
    >
      {/* Header */}
      <header className="flex items-center gap-3 px-3 py-2.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ig-gradient text-[13px] font-bold text-white">
          {meta.emoji}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{meta.label}</span>
            {post.pinned && (
              <Pin className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Pinned" />
            )}
          </div>
          <span className="text-[11px] text-muted-foreground">{formatWhen(post.postedAt)}</span>
        </div>
        <button
          type="button"
          onClick={stop}
          aria-label="Post options"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </header>

      {/* Media / hero area — edge-to-edge square. Renders a rich gradient
          placeholder with the post title when no image is available (which
          is the case today for team posts). */}
      <div {...openProps} className="relative w-full">
        <div className="relative aspect-square w-full bg-ig-gradient">
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
            <div>
              <div className="text-5xl">{meta.emoji}</div>
              <h3 className="mt-3 font-display text-2xl font-bold leading-tight text-white drop-shadow-lg">
                {post.title}
              </h3>
              {isEvent && post.date && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatWhen(post.date)}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-1 px-2 pt-2">
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            setLiked((v) => !v);
          }}
          aria-label={liked ? "Unlike" : "Like"}
          className="grid h-11 w-11 place-items-center rounded-full text-foreground transition active:scale-90"
        >
          <Heart
            className={`h-6 w-6 ${liked ? "text-coral" : ""}`}
            fill={liked ? "currentColor" : "none"}
            strokeWidth={2}
          />
        </button>
        <button
          type="button"
          onClick={
            onClick
              ? (e) => {
                  stop(e);
                  onClick();
                }
              : stop
          }
          aria-label="Comment"
          className="grid h-11 w-11 place-items-center rounded-full text-foreground transition active:scale-90"
        >
          <MessageCircle className="h-6 w-6" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={stop}
          aria-label="Share"
          className="grid h-11 w-11 place-items-center rounded-full text-foreground transition active:scale-90"
        >
          <Send className="h-6 w-6" strokeWidth={2} />
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            setSaved((v) => !v);
          }}
          aria-label={saved ? "Unsave" : "Save"}
          className="grid h-11 w-11 place-items-center rounded-full text-foreground transition active:scale-90"
        >
          <Bookmark className="h-6 w-6" fill={saved ? "currentColor" : "none"} strokeWidth={2} />
        </button>
      </div>

      {/* Caption + meta */}
      <div {...openProps} className="px-4 pb-3">
        {typeof post.rsvps === "number" && (
          <div className="text-sm font-semibold">{post.rsvps} reactions</div>
        )}
        <p className="mt-1 text-sm">
          <span className="mr-1.5 font-semibold">{meta.label}</span>
          <span className="line-clamp-3 text-foreground/90">{post.body || post.title}</span>
        </p>

        {isEvent && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {post.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {post.location}
                </span>
              )}
              {typeof post.price === "number" && (
                <span className="inline-flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5" />
                  {post.price === 0 ? "Free" : `$${post.price}`}
                </span>
              )}
              {post.spots && (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {post.spots.taken}/{post.spots.max}
                </span>
              )}
            </div>

            {post.spots && (
              <div className="h-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full ${spotsLeft <= 3 ? "bg-coral-gradient" : "bg-ig-gradient"}`}
                  style={{ width: `${fillPct}%` }}
                />
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={(e) => {
                  stop(e);
                  if (post.kind === "tryout" || post.kind === "clinic") {
                    navigate({ to: "/tryouts/$postId", params: { postId: post.id } });
                  } else {
                    onClick?.();
                  }
                }}
                className="flex-1 rounded-lg bg-foreground py-2 text-sm font-semibold text-background"
              >
                {post.kind === "tryout" ? "Apply" : "RSVP"}
              </button>
              <button
                type="button"
                onClick={stop}
                className="rounded-lg border border-border bg-transparent px-4 py-2 text-sm font-semibold"
              >
                Share
              </button>
            </div>
          </div>
        )}

        <div className="mt-2 micro-label text-muted-foreground">
          {formatWhen(post.postedAt)}
        </div>
      </div>
    </article>
  );
}
