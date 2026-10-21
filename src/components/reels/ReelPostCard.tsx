/**
 * Review → Post for a finished draft reel.
 *
 * New uploads start as drafts, visible only to their owner. This card is the one
 * place they decide what goes out: pick a caption from the three the AI drafted,
 * trim the hashtags, choose whether to add the on-screen text cards, and tap Post.
 * Nothing the AI wrote is applied until they do.
 */

import { useMemo, useState } from "react";
import { Check, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { postReel } from "@/lib/reels.functions";
import { captionChoices, type PostPackage } from "@/lib/reel-post";

export function ReelPostCard({
  reelId,
  title,
  currentCaption,
  currentHashtags,
  pkg,
  heldBySafety,
}: {
  reelId: string;
  title: string;
  currentCaption: string | null;
  currentHashtags: string[] | null;
  pkg: PostPackage | null;
  /** hidden_at is set: a safety hold or an owner hide that posting does not lift. */
  heldBySafety: boolean;
}) {
  const captions = useMemo(() => captionChoices(pkg, currentCaption), [pkg, currentCaption]);
  const tags = useMemo(
    () => (pkg?.hashtags.length ? pkg.hashtags : (currentHashtags ?? [])),
    [pkg, currentHashtags],
  );

  const [name, setName] = useState(title);
  const [caption, setCaption] = useState<string>(captions[0] ?? "");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(tags));
  const [overlaysOn, setOverlaysOn] = useState(false);
  const [posting, setPosting] = useState(false);

  const overlays = pkg?.overlays ?? [];

  function toggleTag(tag: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  async function post() {
    setPosting(true);
    try {
      const res = await postReel({
        data: {
          reelId,
          title: name.trim() || undefined,
          caption: caption || undefined,
          hashtags: tags.filter((t) => picked.has(t)),
          overlays: overlaysOn ? overlays : undefined,
        },
      });
      toast.success(
        res.heldForReview
          ? "Posted — it will show once our safety check finishes reviewing it"
          : "Posted",
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Could not post this reel");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-lime/40 bg-lime/5 p-3" aria-label="Review and post">
      <p className="micro-label text-lime">Ready to post</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Only you can see this until you post it. Posting shares it on your profile and the
        highlights feed where your age allows.
      </p>

      <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Title
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-foreground"
        />
      </label>

      {captions.length > 0 && (
        <fieldset className="mt-3">
          <legend className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Caption
          </legend>
          <div className="mt-1 space-y-1.5">
            {captions.map((c) => (
              <label
                key={c}
                className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${
                  caption === c ? "border-lime bg-lime/10" : "border-border bg-background/60"
                }`}
              >
                <input
                  type="radio"
                  name={`caption-${reelId}`}
                  checked={caption === c}
                  onChange={() => setCaption(c)}
                  className="mt-0.5 accent-lime"
                />
                <span className="min-w-0 flex-1 break-words">{c}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {tags.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Hashtags
          </p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {tags.map((t) => {
              const on = picked.has(t);
              return (
                <li key={t}>
                  <button
                    type="button"
                    onClick={() => toggleTag(t)}
                    aria-pressed={on}
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      on
                        ? "border-lime bg-lime/10 text-lime"
                        : "border-border text-muted-foreground line-through"
                    }`}
                  >
                    #{t}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {overlays.length > 0 && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={overlaysOn}
            onChange={(e) => setOverlaysOn(e.target.checked)}
            className="mt-0.5 accent-lime"
          />
          <span className="min-w-0 flex-1">
            Add {overlays.length} on-screen text card{overlays.length === 1 ? "" : "s"}
            <span className="block text-[11px] text-muted-foreground">
              {overlays.map((o) => (o.at ? `${o.at} ${o.text}` : o.text)).join(" · ")}
            </span>
          </span>
        </label>
      )}

      {heldBySafety && (
        <p className="mt-3 text-[11px] text-amber-300">
          This reel is on hold. Posting records your choice, and it goes live once the hold is
          cleared.
        </p>
      )}

      <button
        type="button"
        onClick={post}
        disabled={posting}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-lime py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60"
      >
        {posting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : heldBySafety ? (
          <Check className="h-4 w-4" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        {posting ? "Posting…" : "Post"}
      </button>
    </div>
  );
}
