import { Calendar, MapPin, Users, DollarSign, Pin, Share2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { POST_KIND_META, type OrgPost } from "@/lib/sample-data";
import { formatWhen } from "@/lib/format";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PostEngagement } from "@/components/PostEngagement";

export type PostDetailsTeam = {
  id: string;
  name: string;
  sport?: string;
};

export function PostDetailsDialog({
  post,
  team,
  open,
  onOpenChange,
}: {
  post: OrgPost | null;
  team?: PostDetailsTeam | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!post) return null;
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

  const handleShare = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: post.title, text: post.body, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      }
    } catch {
      /* user cancelled */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl p-0">
        <div className="p-5">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex items-center justify-between gap-3">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${accent}`}
              >
                <span>{meta.emoji}</span> {meta.label}
              </span>
              {post.pinned && (
                <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 text-lime px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                  <Pin className="h-3 w-3" /> Pinned
                </span>
              )}
            </div>

            {team && (
              <Link
                to="/teams/$teamId"
                params={{ teamId: team.id }}
                onClick={() => onOpenChange(false)}
                className="flex items-center gap-2 text-xs font-semibold"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-lime/10 text-lime text-[11px] font-bold">
                  {team.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate">{team.name}</span>
                {team.sport && <span className="text-muted-foreground">· {team.sport}</span>}
              </Link>
            )}

            <DialogTitle className="font-display text-2xl font-bold leading-tight">
              {post.title}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Posted {formatWhen(post.postedAt)}
            </DialogDescription>
          </DialogHeader>

          <p className="mt-4 whitespace-pre-wrap text-sm text-foreground/90">{post.body}</p>

          {isEvent && (
            <div className="mt-5 space-y-3 rounded-2xl border border-border bg-surface p-4">
              <div className="grid gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-lime" />
                  <span className="font-semibold">{formatWhen(post.date)}</span>
                </div>
                {post.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-coral" />
                    <span>{post.location}</span>
                  </div>
                )}
                {typeof post.price === "number" && (
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    <span>{post.price === 0 ? "Free" : `$${post.price}`}</span>
                  </div>
                )}
              </div>

              {post.spots && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="inline-flex items-center gap-1.5">
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
                    <div
                      style={{ width: `${fillPct}%` }}
                      className={`h-full ${spotsLeft <= 3 ? "bg-coral-gradient" : "bg-lime-gradient"}`}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {!isEvent && typeof post.rsvps === "number" && (
            <div className="mt-4 text-xs text-muted-foreground">❤ {post.rsvps} reactions</div>
          )}

          <div className="mt-5 flex gap-2">
            {isEvent && (
              <button className="flex-1 rounded-full bg-lime-gradient py-2.5 text-sm font-bold text-primary-foreground glow-lime">
                {post.kind === "tryout" ? "Apply" : "RSVP"}
              </button>
            )}
            <button
              onClick={handleShare}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-semibold"
            >
              <Share2 className="h-4 w-4" /> Share
            </button>
          </div>

          <PostEngagement subjectType="team_post" subjectId={post.id} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
