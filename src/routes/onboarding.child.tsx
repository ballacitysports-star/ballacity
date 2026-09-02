import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Clock, Copy, ShieldCheck } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { useMyChildStatus, useRequestParentalConsent } from "@/lib/child-safety";
import { CHILD_POLICY_DISCLAIMER } from "@/lib/child-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/onboarding/child")({
  head: () =>
    pageHead({
      path: "/onboarding/child",
      title: "Parent or guardian approval — ballaCity",
      description:
        "Under-13 ballaCity accounts need a parent or guardian to approve them before games, messages and videos turn on.",
      noindex: true,
    }),
  ssr: false,
  component: ChildOnboardingPage,
});

const RELATIONSHIPS = [
  { value: "parent", label: "Parent" },
  { value: "guardian", label: "Legal guardian" },
  { value: "other", label: "Other adult responsible for me" },
] as const;

const COLLECTED_BEFORE_CONSENT = [
  "Your first name or nickname",
  "Your date of birth (kept private)",
  "Your parent or guardian's email address",
];

const NOT_COLLECTED_BEFORE_CONSENT = [
  "Profile photo",
  "Precise or home location",
  "Phone number",
  "Sports history or stats",
  "Messages, videos or highlight reels",
  "Followers, teams or a public profile",
];

function ChildOnboardingPage() {
  const { status, state, isLoading, refetch, policy } = useMyChildStatus();
  const request = useRequestParentalConsent();
  const [parentEmail, setParentEmail] = useState("");
  const [parentName, setParentName] = useState("");
  const [relationship, setRelationship] = useState<"parent" | "guardian" | "other">("guardian");
  const [link, setLink] = useState<string | null>(null);

  const approved = state === "PARENTAL_CONSENT_APPROVED";
  const pending = state === "PARENTAL_CONSENT_PENDING";

  const submit = async () => {
    try {
      const res = await request.mutateAsync({ parentEmail, parentName, relationship });
      setLink(`${window.location.origin}${(res as { path: string }).path}`);
      toast.success("Approval request created — send the link to your parent or guardian.");
      void refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the request.");
    }
  };

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6 pb-24">
      <div className="flex items-center gap-2 text-primary">
        <ShieldCheck className="h-5 w-5" aria-hidden />
        <span className="text-xs font-bold uppercase tracking-wide">
          Guardian approval needed
        </span>
      </div>
      <h1 className="mt-2 font-display text-2xl font-bold">
        A parent or guardian approves this account
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        ballaCity requires a parent or guardian to approve accounts for members under{" "}
        {policy.parentalConsentMaxAge + 1}. Until they do, we keep things switched off — no
        messages, no videos, no public profile.
      </p>

      {isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Checking your account…</p>
      ) : approved ? (
        <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2 font-semibold text-emerald-600">
            <CheckCircle2 className="h-5 w-5" aria-hidden /> Approved
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Your parent or guardian approved this account. They can change your settings anytime in
            the Parent Center.
          </p>
          <Link
            to="/feed"
            className="mt-3 inline-block rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
          >
            Go to ballaCity
          </Link>
        </div>
      ) : (
        <>
          <section className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-surface p-4">
              <h2 className="text-sm font-bold">What we collect now</h2>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {COLLECTED_BEFORE_CONSENT.map((i) => (
                  <li key={i}>• {i}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4">
              <h2 className="text-sm font-bold">What we do not collect yet</h2>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {NOT_COLLECTED_BEFORE_CONSENT.map((i) => (
                  <li key={i}>• {i}</li>
                ))}
              </ul>
            </div>
          </section>

          {pending && status?.consent?.parentEmail ? (
            <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-center gap-2 font-semibold text-amber-600">
                <Clock className="h-5 w-5" aria-hidden /> Waiting for approval
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                We're waiting for {status.consent.parentEmail} to approve. They need to open the
                approval link and sign in with their own adult ballaCity account.
              </p>
            </div>
          ) : null}

          <section className="mt-6 space-y-3 rounded-2xl border border-border bg-surface p-4">
            <h2 className="text-sm font-bold">
              {pending ? "Send a new approval request" : "Ask your parent or guardian"}
            </h2>
            <div className="space-y-1.5">
              <Label htmlFor="parent-email">Their email address</Label>
              <Input
                id="parent-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="guardian@example.com"
                value={parentEmail}
                onChange={(e) => setParentEmail(e.target.value)}
                maxLength={255}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="parent-name">Their name (optional)</Label>
              <Input
                id="parent-name"
                value={parentName}
                onChange={(e) => setParentName(e.target.value)}
                maxLength={120}
                placeholder="Alex Rivera"
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Who are they?</span>
              <div className="flex flex-wrap gap-2">
                {RELATIONSHIPS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRelationship(r.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      relationship === r.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <Button
              onClick={submit}
              disabled={request.isPending || !parentEmail.includes("@")}
              className="w-full"
            >
              {request.isPending ? "Creating request…" : "Create approval request"}
            </Button>
          </section>

          {link ? (
            <section className="mt-4 rounded-2xl border border-border bg-surface p-4">
              <h2 className="text-sm font-bold">Approval link</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Give this one-time link to your parent or guardian. It expires in 72 hours and can
                only be used once, and they must sign in with their own adult account to approve.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-background px-2 py-1.5 text-[11px]">
                  {link}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(link);
                    toast.success("Link copied");
                  }}
                >
                  <Copy className="mr-1 h-3.5 w-3.5" aria-hidden /> Copy
                </Button>
              </div>
            </section>
          ) : null}
        </>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">{CHILD_POLICY_DISCLAIMER}</p>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <Link to="/safety/children" className="font-semibold text-primary underline">
          Child &amp; teen safety
        </Link>
        <Link to="/privacy" className="font-semibold text-primary underline">
          Privacy Policy
        </Link>
        <Link to="/contact" className="font-semibold text-primary underline">
          Contact support
        </Link>
      </div>
    </main>
  );
}
