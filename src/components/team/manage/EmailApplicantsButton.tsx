import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { emailTryoutApplicants } from "@/lib/tryouts.functions";

export function EmailApplicantsButton({ teamId, postId, count }: { teamId: string; postId: string; count: number }) {
  const send = useServerFn(emailTryoutApplicants);
  const [busy, setBusy] = useState(false);
  if (count === 0) return null;
  const onClick = async () => {
    if (!confirm(`Email a tryout invite to ${count} applicant${count === 1 ? "" : "s"}? Parents get it when they applied for their child.`)) return;
    setBusy(true);
    try {
      const r = await send({ data: { teamId, postId } });
      toast.success(`Sent ${r.sent} invite${r.sent === 1 ? "" : "s"}${r.skipped ? ` · ${r.skipped} skipped` : ""}${r.failed ? ` · ${r.failed} failed` : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send invites.");
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
