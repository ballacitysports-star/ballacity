import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  VERIFICATION_METHODS,
  describeSignals,
  evidenceRefProblem,
  friendlyGuardianClaimError,
  reasonProblem,
  type VerificationMethod,
} from "@/lib/guardian-claims";

type Claim = {
  request_id: string;
  kind: "first_guardian" | "additional_guardian";
  source: "family_invite" | "consent_email";
  relationship: string;
  signals: string[];
  created_at: string;
  child_user_id: string;
  child_name: string | null;
  child_cohort: string;
  guardian_user_id: string;
  guardian_name: string | null;
  guardian_email: string | null;
  guardian_cohort: string;
  guardian_eligible: boolean;
};

const queueKey = ["admin-guardian-claims"];

/**
 * SEC-4 staff queue: a new parent or guardian gets no access until staff verify
 * them here (or a current verified guardian approves them). The server function
 * re-checks everything; this only collects the method, the evidence reference
 * and, for a claimant who already shares a team, game or conversation with the
 * child, the reviewer's explicit acknowledgement.
 */
export function GuardianClaimQueue() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: queueKey,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("staff_guardian_claims" as never);
      if (error) throw new Error(friendlyGuardianClaimError(error.message));
      return (data ?? []) as unknown as Claim[];
    },
  });

  const verify = useMutation({
    mutationFn: async (v: {
      id: string;
      method: VerificationMethod;
      ref: string;
      acknowledge: boolean;
    }) => {
      const { error } = await supabase.rpc(
        "staff_verify_guardian_claim" as never,
        {
          _request: v.id,
          _method: v.method,
          _evidence_ref: v.ref.trim(),
          _acknowledge_signals: v.acknowledge,
        } as never,
      );
      if (error) throw new Error(friendlyGuardianClaimError(error.message));
    },
    onSuccess: () => {
      toast.success("Verified. The guardian is now linked.");
      void qc.invalidateQueries({ queryKey: queueKey });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not verify."),
  });

  const decline = useMutation({
    mutationFn: async (v: { id: string; reason: string }) => {
      const { error } = await supabase.rpc(
        "staff_decline_guardian_claim" as never,
        { _request: v.id, _reason: v.reason.trim() } as never,
      );
      if (error) throw new Error(friendlyGuardianClaimError(error.message));
    },
    onSuccess: () => {
      toast.success("Declined. Nobody was linked.");
      void qc.invalidateQueries({ queryKey: queueKey });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not decline."),
  });

  const rows = q.data ?? [];

  return (
    <section className="mt-5 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <UserCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="font-display text-sm font-bold">Guardian verification</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        A new parent or guardian gets no access until they are verified. Check their identity and
        relationship outside the app, then record how and a case reference (never the document
        itself).
      </p>
      {q.error ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {q.error instanceof Error ? q.error.message : "Could not load the queue."}
        </p>
      ) : q.isLoading ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Nobody is waiting.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((r) => (
            <ClaimRow
              key={r.request_id}
              claim={r}
              busy={verify.isPending || decline.isPending}
              onVerify={(method, ref, acknowledge) =>
                verify.mutate({ id: r.request_id, method, ref, acknowledge })
              }
              onDecline={(reason) => decline.mutate({ id: r.request_id, reason })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ClaimRow({
  claim,
  busy,
  onVerify,
  onDecline,
}: {
  claim: Claim;
  busy: boolean;
  onVerify: (method: VerificationMethod, ref: string, acknowledge: boolean) => void;
  onDecline: (reason: string) => void;
}) {
  const [method, setMethod] = React.useState<VerificationMethod>("government_id");
  const [ref, setRef] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [acknowledge, setAcknowledge] = React.useState(false);
  const signals = describeSignals(claim.signals);
  const refProblem = ref ? evidenceRefProblem(ref) : null;
  const canVerify =
    claim.guardian_eligible &&
    !evidenceRefProblem(ref) &&
    (signals.length === 0 || acknowledge) &&
    !busy;

  return (
    <li className="rounded-xl border border-border bg-background p-3 text-xs">
      <div className="text-sm font-semibold">
        {claim.guardian_name ?? "Someone"} → {claim.child_name ?? "a player"}
      </div>
      <div className="mt-1 text-muted-foreground">
        {claim.kind === "first_guardian" ? "First guardian" : "Additional guardian"} ·{" "}
        {claim.relationship} · via{" "}
        {claim.source === "consent_email" ? "consent email" : "family invitation"} ·{" "}
        {new Date(claim.created_at).toLocaleDateString()}
      </div>
      <div className="mt-1 text-muted-foreground">
        Guardian: {claim.guardian_email ?? "no email"} · {claim.guardian_cohort}
        {claim.guardian_eligible ? "" : " · not eligible (not a verified adult in good standing)"}
        {" · "}Player: {claim.child_cohort}
      </div>
      {signals.length > 0 ? (
        <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2">
          <p className="font-semibold">This person already knows the player through BallaCity:</p>
          <ul className="mt-1 list-disc pl-4">
            {signals.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={acknowledge}
              onChange={(e) => setAcknowledge(e.target.checked)}
            />
            I checked this and confirmed they are the parent or legal guardian.
          </label>
        </div>
      ) : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <select
          aria-label="Verification method"
          className="rounded-lg border border-border bg-surface px-2 py-1.5"
          value={method}
          onChange={(e) => setMethod(e.target.value as VerificationMethod)}
        >
          {VERIFICATION_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <input
          aria-label="Evidence reference"
          className="rounded-lg border border-border bg-surface px-2 py-1.5"
          placeholder="Case or ticket reference"
          maxLength={200}
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
      </div>
      {refProblem ? <p className="mt-1 text-destructive">{refProblem}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" disabled={!canVerify} onClick={() => onVerify(method, ref, acknowledge)}>
          Verify and link
        </Button>
        <input
          aria-label="Decline reason"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5"
          placeholder="Reason to decline"
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || reasonProblem(reason) !== null}
          onClick={() => onDecline(reason)}
        >
          Decline
        </Button>
      </div>
    </li>
  );
}
