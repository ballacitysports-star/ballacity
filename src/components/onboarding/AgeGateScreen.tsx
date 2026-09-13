import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  ACCOUNT_TYPE_ROUTE,
  CHILD_CONSENT_ROUTE,
  EMPTY_DOB,
  MONTHS,
  checkDobParts,
  clearPendingDob,
  readPendingDob,
  useMyAgeStatus,
  useSubmitBirthday,
  type DobParts,
} from "@/lib/age-verification";
import { parseCohort, requiresParentalConsent } from "@/lib/child-policy";
import { useAgePolicy } from "@/lib/youth-features";

/**
 * The date-of-birth step. Rendered either as its own page (/onboarding/age) or
 * inline by the root gate, so a member who lands on a protected route gets the
 * real form in place instead of a redirect that may never resolve.
 *
 * `onResolved` is called once the server has determined a cohort. When it is
 * omitted the screen navigates onward itself (standalone page behaviour).
 */
export function AgeGateScreen({ onResolved }: { onResolved?: (cohort: string) => void }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const status = useMyAgeStatus(!!user);
  const { policy } = useAgePolicy();
  const submitBirthday = useSubmitBirthday();
  const [dob, setDob] = useState<DobParts>(EMPTY_DOB);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [loading, user, navigate]);

  const routeOnward = (cohort: string) => {
    if (onResolved) {
      onResolved(cohort);
      return;
    }
    // Anyone in a cohort that needs a guardian (under-16 by default) goes to the
    // consent flow; nobody reaches ordinary onboarding before the server has
    // determined their age.
    const needsGuardian = requiresParentalConsent(parseCohort(cohort), policy);
    window.location.replace(needsGuardian ? CHILD_CONSENT_ROUTE : ACCOUNT_TYPE_ROUTE);
  };

  const save = async (iso: string) => {
    setBusy(true);
    try {
      const result = await submitBirthday(iso);
      clearPendingDob();
      routeOnward(result.cohort);
    } catch (err) {
      setBusy(false);
      const message =
        err instanceof Error ? err.message : "We couldn't save your date of birth. Try again.";
      setError(message);
      toast.error(message);
    }
  };

  // A date of birth typed on the signup form (before the session existed) is
  // applied automatically so the member isn't asked for it twice.
  const [pendingTried, setPendingTried] = useState(false);
  useEffect(() => {
    if (pendingTried || busy || !user || status.isLoading) return;
    // Leave this screen only once the SERVER has actually determined the
    // cohort. A stored birthday with an undetermined cohort would otherwise
    // bounce straight back here from the root age gate.
    if (status.data && status.data.birthdaySet && status.data.cohort !== "unknown") {
      routeOnward(status.data.cohort);
      return;
    }
    if (status.data && status.data.birthdaySet) {
      // Birthday saved but age still undetermined — offer a retry instead of
      // redirecting into a loop.
      setPendingTried(true);
      setError("We saved your date of birth but couldn't finish checking your account. Try again.");
      return;
    }
    const pending = readPendingDob();
    setPendingTried(true);
    if (pending) void save(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, status.isLoading, status.data, pendingTried, busy]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const check = checkDobParts(dob);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setError(null);
    void save(check.iso);
  };

  if (loading || !user) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <LoadingState label="Loading your account…" />
      </div>
    );
  }

  return (
    <OnboardingShell
      step={1}
      steps={2}
      title="Your date of birth"
      description="Your age helps us provide the right safety, privacy and account experience. Everyone is welcome on ballaCity — we just set things up differently depending on your age."
    >
      <>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <fieldset>
            <legend className="text-sm font-semibold">Date of birth</legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <label className="sr-only" htmlFor="dob-month">
                Birth month
              </label>
              <select
                id="dob-month"
                value={dob.month}
                onChange={(e) => setDob((p) => ({ ...p, month: e.target.value }))}
                className="rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-lime"
              >
                <option value="">Month</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="dob-day">
                Birth day
              </label>
              <select
                id="dob-day"
                value={dob.day}
                onChange={(e) => setDob((p) => ({ ...p, day: e.target.value }))}
                className="rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-lime"
              >
                <option value="">Day</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={String(d)}>
                    {d}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="dob-year">
                Birth year
              </label>
              <input
                id="dob-year"
                inputMode="numeric"
                autoComplete="bday-year"
                placeholder="Year"
                maxLength={4}
                value={dob.year}
                onChange={(e) =>
                  setDob((p) => ({ ...p, year: e.target.value.replace(/[^0-9]/g, "").slice(0, 4) }))
                }
                className="rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-lime"
              />
            </div>
            {error ? (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </fieldset>

          <div className="rounded-2xl border border-border bg-surface p-3 text-xs leading-snug text-muted-foreground">
            <strong className="text-foreground">Why we ask:</strong> your age helps us provide the
            right safety, privacy and account experience. Your exact birth date stays private — it
            is never shown on your profile.
          </div>

          <PrimaryCTA type="submit" loading={busy}>
            Continue
          </PrimaryCTA>
        </form>
      </>
    </OnboardingShell>
  );
}
