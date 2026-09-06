import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ShieldCheck } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { useAuth } from "@/hooks/use-auth";
import { CHILD_POLICY_DISCLAIMER, CONSENT_METHOD_META } from "@/lib/child-policy";
import {
  approveConsentAsGuardian,
  lookupConsentRequest,
  type ConsentLookup,
} from "@/lib/child-safety.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/parent/consent/$token")({
  head: () =>
    pageHead({
      title: "Approve a child's ballaCity account",
      description:
        "Review what ballaCity collects and what your child can do, then approve or decline the account.",
      noindex: true,
    }),
  ssr: false,
  component: ConsentApprovalPage,
});

const CONSENT_SCOPE = [
  {
    key: "profile",
    label: "A private player profile",
    detail: "Display name, username, sports and a general city — never a home address.",
  },
  {
    key: "games",
    label: "Joining games an adult hosts",
    detail: "Venue details are shared with the host and participants only.",
  },
  {
    key: "messaging",
    label: "Limited messaging",
    detail: "Unknown adults cannot message your child. You can turn messaging off entirely.",
  },
  {
    key: "media",
    label: "Private highlight videos",
    detail: "Videos stay private unless you allow teammates to see them. Never public by default.",
  },
];

function ConsentApprovalPage() {
  const { token } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const lookup = useServerFn(lookupConsentRequest);
  const approve = useServerFn(approveConsentAsGuardian);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const query = useQuery({
    queryKey: ["consent-lookup", token],
    queryFn: () => lookup({ data: { token } }) as Promise<ConsentLookup>,
  });
  const info = query.data;

  const submit = async () => {
    setSubmitting(true);
    try {
      await approve({ data: { token, acknowledgedPolicies: true, scope: { all: true } } });
      toast.success("Approved — you can manage settings in the Parent Center.");
      void navigate({ to: "/parent" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not approve this request.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6 pb-24">
      <div className="flex items-center gap-2 text-primary">
        <ShieldCheck className="h-5 w-5" aria-hidden />
        <span className="text-xs font-bold uppercase tracking-wide">Parent / guardian approval</span>
      </div>
      <h1 className="mt-2 font-display text-2xl font-bold">
        Approve {info?.childDisplayName ?? "a child"}&rsquo;s ballaCity account
      </h1>

      {query.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Checking this link…</p>
      ) : !info?.valid ? (
        <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          {info?.reason ?? "This approval link is no longer valid."}
        </div>
      ) : (
        <>
          <section className="mt-5 rounded-2xl border border-border bg-surface p-4">
            <h2 className="text-sm font-bold">What you are approving</h2>
            <ul className="mt-2 space-y-2">
              {CONSENT_SCOPE.map((s) => (
                <li key={s.key} className="text-xs">
                  <span className="block font-semibold text-foreground">{s.label}</span>
                  <span className="text-muted-foreground">{s.detail}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-4 rounded-2xl border border-border bg-surface p-4 text-xs text-muted-foreground">
            <h2 className="text-sm font-bold text-foreground">Your controls</h2>
            <p className="mt-1">
              After approving you get a Parent Center where you can change messaging, video
              visibility, discoverability and AI analysis, request a copy of your child's
              information, ask for corrections or deletion, and withdraw consent at any time.
              Withdrawing consent immediately turns off messaging, hides videos and makes the
              profile private.
            </p>
            <p className="mt-2">
              Verification method: {CONSENT_METHOD_META.email_confirmation.label}.{" "}
              {CONSENT_METHOD_META.email_confirmation.note}
            </p>
          </section>

          <label className="mt-4 flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 text-xs">
            <button
              type="button"
              role="checkbox"
              aria-checked={acknowledged}
              onClick={() => setAcknowledged((v) => !v)}
              className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border ${
                acknowledged ? "border-primary bg-primary text-primary-foreground" : "border-border"
              }`}
            >
              {acknowledged ? <Check className="h-4 w-4" aria-hidden /> : null}
            </button>
            <span className="leading-relaxed">
              I am the parent or legal guardian of this child. I have read the{" "}
              <Link to="/privacy" className="font-semibold text-primary underline">
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link to="/safety/children" className="font-semibold text-primary underline">
                Children&rsquo;s privacy information
              </Link>
              , and I consent to ballaCity collecting and using my child&rsquo;s information as
              described.
            </span>
          </label>

          {loading ? null : !user ? (
            <div className="mt-4 rounded-2xl border border-border bg-surface p-4 text-xs">
              <p className="text-muted-foreground">
                Sign in with your own adult ballaCity account to approve. This confirms your email and
                gives you the Parent Center.
              </p>
              <Link
                to="/auth"
                className="mt-3 inline-block rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
              >
                Sign in to approve
              </Link>
            </div>
          ) : (
            <Button
              className="mt-4 w-full"
              disabled={!acknowledged || submitting}
              onClick={submit}
            >
              {submitting ? "Approving…" : "Approve this account"}
            </Button>
          )}
        </>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
        {CHILD_POLICY_DISCLAIMER}
      </p>
    </main>
  );
}
