import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  clearPendingConsent,
  readPendingConsent,
  useAcceptLegal,
  useMyLegalConsents,
} from "@/lib/legal-consent";
import { LEGAL_DOCUMENTS, effectiveVersion } from "@/lib/legal-documents";
import { LegalConsent, allAccepted, emptyConsentValue } from "@/components/legal/LegalConsent";

/**
 * Returning users whose accepted version is older than a published material
 * version are asked to accept again before continuing. Nothing is recorded
 * unless they explicitly tick each box.
 */
export function LegalReacceptGate() {
  const { user, loading } = useAuth();
  const { pendingRequired, isLoading, refetch, published } = useMyLegalConsents();
  const accept = useAcceptLegal();
  const [value, setValue] = useState(emptyConsentValue);
  const [replayed, setReplayed] = useState(false);

  // Replay a signup tick that couldn't be written yet (no session at the time).
  useEffect(() => {
    if (!user || replayed || isLoading) return;
    const pending = readPendingConsent();
    if (pending.length === 0) return;
    setReplayed(true);
    const valid = pending.filter((p) => p.version === effectiveVersion(p.type, published).version);
    if (valid.length === 0) {
      clearPendingConsent();
      return;
    }
    accept.mutateAsync(valid).then(
      () => void refetch(),
      () => {
        /* the gate below will ask again */
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isLoading, replayed]);

  if (loading || !user || isLoading) return null;
  if (pendingRequired.length === 0) return null;

  const submit = async () => {
    if (!allAccepted(value, pendingRequired)) return;
    try {
      await accept.mutateAsync(
        pendingRequired.map((type) => ({ type, version: effectiveVersion(type, published).version })),
      );
      toast.success("Thanks — your agreement is recorded.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't record your agreement");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Updated legal documents"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center"
    >
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-border bg-background p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-xl">
        <h2 className="text-lg font-bold">We've updated our legal documents</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {pendingRequired.map((t) => LEGAL_DOCUMENTS[t].title).join(" and ")} changed. Please review
          and accept the current version to keep using OpenRun.
        </p>
        <div className="mt-4">
          <LegalConsent
            value={value}
            onChange={setValue}
            types={pendingRequired}
            disabled={accept.isPending}
          />
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!allAccepted(value, pendingRequired) || accept.isPending}
          className="mt-4 w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {accept.isPending ? "Saving…" : "Agree and continue"}
        </button>
        <Link
          to="/account/legal"
          className="mt-2 block w-full text-center text-xs text-muted-foreground underline"
        >
          View my consent history
        </Link>
      </div>
    </div>
  );
}
