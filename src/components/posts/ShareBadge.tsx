import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useMyAge } from "@/lib/use-my-age";
import { cohortFromAge } from "@/lib/child-policy";
import { getBadge } from "@/lib/badges";
import { heldNotice } from "@/lib/post-moderation";
import {
  AUDIENCE_LABELS,
  achievementAudiences,
  achievementPostBody,
  postErrorMessage,
  useNetworkPostsEnabled,
  type PostAudience,
} from "@/lib/network-posts";
import { createNetworkPost } from "@/lib/network-posts.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Share an earned badge as an achievement post (P3-8). Opt-in: nothing is posted until the
 * player picks an audience and presses Share. The audiences are the ones this age may use
 * (the database enforces the same); the text is AI-screened like any other post. Renders
 * nothing when posts are off, signed out, or this age may not post.
 */
export function ShareBadge({ badgeId }: { badgeId: string }) {
  const enabled = useNetworkPostsEnabled();
  const { user } = useAuth();
  const { age, loading } = useMyAge();
  const qc = useQueryClient();
  const create = useServerFn(createNetworkPost);
  const [open, setOpen] = useState(false);
  const badge = getBadge(badgeId);
  const options = achievementAudiences(cohortFromAge(age));
  const [audience, setAudience] = useState<PostAudience | null>(null);
  const chosen = audience && options.includes(audience) ? audience : (options[0] ?? null);

  const share = useMutation({
    mutationFn: () =>
      create({
        data: {
          kind: "achievement",
          audience: chosen as PostAudience,
          body: achievementPostBody(badge!),
        },
      }),
    onSuccess: (res) => {
      const held = heldNotice(res);
      if (held) toast.message(held);
      else toast.success("Shared");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["network-posts-feed"] });
    },
    onError: (e) => toast.error(postErrorMessage(e instanceof Error ? e.message : String(e))),
  });

  if (!enabled || !user || loading || !badge || options.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Share the ${badge.label} badge`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground"
      >
        <Share2 className="h-3.5 w-3.5" aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share this badge?</DialogTitle>
            <DialogDescription>It is posted only if you press Share.</DialogDescription>
          </DialogHeader>
          <p className="rounded-xl border border-border bg-surface p-3 text-sm">
            {achievementPostBody(badge)}
          </p>
          <fieldset className="space-y-1">
            <legend className="text-sm font-semibold">Who can see it</legend>
            {options.map((a) => (
              <label key={a} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name={`share-${badgeId}`}
                  checked={chosen === a}
                  onChange={() => setAudience(a)}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold">{AUDIENCE_LABELS[a].label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {AUDIENCE_LABELS[a].description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!chosen || share.isPending} onClick={() => share.mutate()}>
              Share
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
