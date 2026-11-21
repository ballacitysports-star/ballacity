import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { emailTryoutApplicants } from "@/lib/tryouts.functions";
import { errorText, userErrorMessage } from "@/lib/user-error";

/** The sentences emailTryoutApplicants (tryouts.functions.ts) throws itself. */
const OWN_EMAIL_ERRORS: ReadonlySet<string> = new Set([
  "Only owners, managers and coaches can email applicants.",
  "Tryout not found.",
]);

export function EmailApplicantsButton({
  teamId,
  postId,
  count,
}: {
  teamId: string;
  postId: string;
  count: number;
}) {
  const send = useServerFn(emailTryoutApplicants);
  const [busy, setBusy] = useState(false);
  if (count === 0) return null;
  const onClick = async () => {
    if (
      !confirm(
        `Email a tryout invite to ${count} applicant${count === 1 ? "" : "s"}? Parents get it when they applied for their child.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await send({ data: { teamId, postId } });
      toast.success(
        `Sent ${r.sent} invite${r.sent === 1 ? "" : "s"}${r.skipped ? ` · ${r.skipped} skipped` : ""}${r.failed ? ` · ${r.failed} failed` : ""}`,
      );
    } catch (e) {
      const text = errorText(e);
      // emailTryoutApplicants' own refusals say what to do; anything else is never shown raw (WP 4.0).
      toast.error(
        text && OWN_EMAIL_ERRORS.has(text)
          ? text
          : userErrorMessage(e, "Couldn't send invites. Please try again."),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="mt-2 inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-bold text-muted-foreground disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
      Email applicants
    </button>
  );
}
