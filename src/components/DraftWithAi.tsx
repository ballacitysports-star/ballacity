import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sparkles, Undo2 } from "lucide-react";
import { suggestTeamPostDraft } from "@/lib/team-posts.functions";
import type { TeamPostKind } from "@/lib/sample-data";

/** The server needs at least this much to write from (matches suggestTeamPostDraft). */
export const DRAFT_MIN_NOTES = 10;

export type PostDraftText = { title: string; body: string };

/**
 * "Draft with AI" for any post form: the member jots rough notes in the details
 * box and this fills in the title and description from them. It never submits
 * anything, and one tap on Undo puts back what the member had typed.
 */
export function DraftWithAi({
  kind,
  title,
  body,
  onApply,
}: {
  kind: TeamPostKind;
  title: string;
  body: string;
  onApply: (text: PostDraftText) => void;
}) {
  const draftFn = useServerFn(suggestTeamPostDraft);
  const [drafting, setDrafting] = useState(false);
  /** What the member had before the AI draft, so one tap puts it back. */
  const [beforeDraft, setBeforeDraft] = useState<PostDraftText | null>(null);

  const draftWithAi = async () => {
    setDrafting(true);
    try {
      const draft = await draftFn({ data: { kind, notes: body, title: title || null } });
      setBeforeDraft({ title, body });
      onApply({ title: draft.title, body: draft.body });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't draft that right now");
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={draftWithAi}
          disabled={drafting || body.trim().length < DRAFT_MIN_NOTES}
          className="inline-flex items-center gap-1 rounded-full border border-lime/40 px-3 py-1.5 text-xs font-bold text-lime disabled:opacity-40"
        >
          <Sparkles className="h-3 w-3" /> {drafting ? "Drafting…" : "Draft with AI"}
        </button>
        {beforeDraft && (
          <button
            type="button"
            onClick={() => {
              onApply(beforeDraft);
              setBeforeDraft(null);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground"
          >
            <Undo2 className="h-3 w-3" /> Undo
          </button>
        )}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Jot rough notes in the details and AI writes the title and details from them. It only uses
        what you wrote — check dates, prices and places before you publish.
      </p>
    </div>
  );
}
