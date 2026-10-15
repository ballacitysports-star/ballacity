/**
 * "Upload a clip for [child]": a guardian's private clip of their under-13 child.
 *
 * This only gathers the choice and explains where the clip can go. The upload itself
 * runs on the Reels page, which strips location and device info from the file, sets
 * the child on the reel, and leaves the database to re-check the guardian link. A
 * family clip is never on the highlights feed, a profile or visible to other members.
 */

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lock, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMyChildren } from "@/lib/child-safety";
import { getFamilyPostsEnabled } from "@/lib/reels.functions";

export function GuardianVideoUploadDialog({
  childUserId,
  className,
}: {
  /** Preselects a child, for use on that child's card. */
  childUserId?: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const fetchEnabled = useServerFn(getFamilyPostsEnabled);
  const { data } = useQuery({
    queryKey: ["family-posts-enabled"],
    queryFn: () => fetchEnabled(),
    staleTime: 60_000,
  });
  const { children } = useMyChildren();
  const eligible = children.filter((c) => c.cohort === "child_under_13" || c.cohort === "teen_13_15");
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(childUserId ?? null);

  if (data?.enabled !== true || eligible.length === 0) return null;

  const selected =
    eligible.find((c) => c.childUserId === (picked ?? (eligible.length === 1 ? eligible[0].childUserId : ""))) ??
    null;
  const aiOff = selected ? !selected.controls.aiAnalysis : false;

  function go() {
    if (!selected || aiOff) return;
    setOpen(false);
    void navigate({
      to: "/reels",
      search: { game: "", title: "", upload: "1", child: selected.childUserId },
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" className={className} onClick={() => setOpen(true)}>
        <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {childUserId && selected ? `Upload a clip for ${selected.displayName}` : "Upload a clip for your child"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload a clip of your child</DialogTitle>
            <DialogDescription>
              It goes in your own reels and is tagged to your child.
            </DialogDescription>
          </DialogHeader>

          {eligible.length > 1 && (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-semibold">Which child?</legend>
              {eligible.map((c) => (
                <label
                  key={c.childUserId}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    selected?.childUserId === c.childUserId ? "border-primary bg-primary/10" : "border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="family-clip-child"
                    checked={selected?.childUserId === c.childUserId}
                    onChange={() => setPicked(c.childUserId)}
                    className="accent-primary"
                  />
                  {c.displayName}
                </label>
              ))}
            </fieldset>
          )}

          <div className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3 text-xs">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <ul className="space-y-1 text-muted-foreground">
              <li>Private to you and your child. It never appears on the highlights feed, a profile or to other members.</li>
              <li>You can later allow a private link or one team to watch it, if you turn those on for your child.</li>
              <li>We remove location, device and date info from the file before it is uploaded.</li>
              <li>The AI analyses the clip. That uses your child&apos;s &ldquo;AI video analysis&rdquo; setting.</li>
            </ul>
          </div>

          {aiOff && (
            <p className="text-xs font-semibold text-amber-300">
              Turn on &ldquo;AI video analysis&rdquo; for {selected?.displayName} in the Parent Center first.
            </p>
          )}

          <Button type="button" onClick={go} disabled={!selected || aiOff}>
            Choose a video
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
