import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Flag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { appealContentDecision } from "@/lib/moderation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type HeldContent = {
  content_type: "team_post" | "comment";
  content_id: string;
  label: string | null;
  level: "held" | "hidden";
  held_at: string;
  has_open_appeal: boolean;
  child_user_id?: string;
};

export const heldContentKey = (scope: string, viewerId: string) => [
  "content-under-review",
  scope,
  viewerId,
];

async function fetchHeld(scope: "mine" | "children"): Promise<HeldContent[]> {
  // Both functions answer only for the signed-in person: their own content, or the content of children they are a verified guardian of.
  const { data, error } = await supabase.rpc(
    (scope === "mine" ? "my_content_holds" : "guardian_content_holds") as never,
  );
  if (error) throw error;
  return (data ?? []) as unknown as HeldContent[];
}

/**
 * Lets an author (or a verified guardian of a minor author) see what a moderator or the reporting rules are holding and ask for a
 * second look. A different moderator reviews it; the authorization is enforced in the database, not here.
 */
export function ContentUnderReview({
  scope,
  viewerId,
  childNames,
}: {
  scope: "mine" | "children";
  viewerId: string;
  childNames?: Record<string, string>;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: heldContentKey(scope, viewerId),
    queryFn: () => fetchHeld(scope),
  });
  const [target, setTarget] = useState<HeldContent | null>(null);
  const [note, setNote] = useState("");
  const appeal = useMutation({
    mutationFn: () => appealContentDecision(target!.content_type, target!.content_id, note),
    onSuccess: () => {
      toast.success("Sent. A different moderator will take another look.");
      setTarget(null);
      setNote("");
      void qc.invalidateQueries({ queryKey: heldContentKey(scope, viewerId) });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't send that."),
  });

  const rows = q.data ?? [];
  if (q.error || rows.length === 0) return null;

  return (
    <section className="mt-6" aria-labelledby={`under-review-${scope}`}>
      <h2
        id={`under-review-${scope}`}
        className="flex items-center gap-2 font-display text-sm font-bold"
      >
        <Flag className="h-4 w-4" aria-hidden />
        {scope === "mine" ? "Your posts under review" : "Your children's posts under review"}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        These were reported and are hidden from other people while a moderator decides. You can ask
        for another look.
      </p>
      <div className="mt-2 space-y-2">
        {rows.map((r) => (
          <div
            key={`${r.content_type}-${r.content_id}`}
            className="rounded-xl border border-border bg-surface p-3"
          >
            <p className="text-sm font-semibold">
              {scope === "children" && r.child_user_id
                ? `${childNames?.[r.child_user_id] ?? "Your child"}: `
                : ""}
              {r.content_type === "team_post" ? "Team post" : "Comment"}
              {r.label ? ` · “${r.label}”` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {r.level === "hidden" ? "Removed by a moderator" : "Held for review"}
            </p>
            <div className="mt-2">
              {r.has_open_appeal ? (
                <span className="text-xs font-semibold text-muted-foreground">
                  Review requested
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setTarget(r)}
                  className="rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
                >
                  Ask for a review
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ask for a review</DialogTitle>
            <DialogDescription>
              Tell the moderator why this should be restored. A different moderator reads it. Please
              don't include addresses or phone numbers.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder="What would you like them to know?"
          />
          <p className="text-right text-xs text-muted-foreground">{note.length}/500</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={appeal.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => appeal.mutate()}
              disabled={appeal.isPending || note.trim().length === 0}
            >
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
