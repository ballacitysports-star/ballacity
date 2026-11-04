import { useState } from "react";
import { Flag } from "lucide-react";
import { ReportDialog } from "@/components/ReportDialog";
import { useAuth } from "@/hooks/use-auth";

/**
 * A small "Report" action for a team post or a comment. It renders only for a signed-in person who is not the author. The database
 * decides again: a person who cannot read the item cannot report it, and the reported account is taken from the item itself.
 */
export function ReportContentButton({
  kind,
  contentId,
  authorId,
  label,
  className,
}: {
  kind: "team_post" | "comment";
  contentId: string;
  authorId: string | null | undefined;
  /** Shown in the dialog title, e.g. the post title. */
  label: string;
  className?: string;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user || !authorId || user.id === authorId) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex items-center gap-1 rounded-full p-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-secondary hover:text-coral"
        }
        aria-label={kind === "team_post" ? "Report post" : "Report comment"}
      >
        <Flag className="h-3 w-3" aria-hidden />
        <span>Report</span>
      </button>
      <ReportDialog
        open={open}
        onOpenChange={setOpen}
        subjectType={kind}
        reportedId={authorId}
        subjectLabel={label}
        teamPostId={kind === "team_post" ? contentId : null}
        commentId={kind === "comment" ? contentId : null}
      />
    </>
  );
}
