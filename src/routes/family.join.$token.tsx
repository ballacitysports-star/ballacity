import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldCheck, Users } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { useAuth } from "@/hooks/use-auth";
import { CHILD_POLICY_DISCLAIMER } from "@/lib/child-policy";
import {
  lookupMinorInvite,
  redeemMinorInvite,
  withdrawMyGuardianClaim,
} from "@/lib/family-invites.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/family/join/$token")({
  head: () =>
    pageHead({
      title: "Join your family on BallaCity",
      description:
        "Accept a parent or guardian invitation so they can manage your BallaCity safety settings.",
      noindex: true,
    }),
  ssr: false,
  component: FamilyJoinPage,
});

function FamilyJoinPage() {
  const { token } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const lookup = useServerFn(lookupMinorInvite);
  const redeem = useServerFn(redeemMinorInvite);
  const withdraw = useServerFn(withdrawMyGuardianClaim);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [verification, setVerification] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const query = useQuery({
    queryKey: ["minor-invite", token],
    queryFn: () => lookup({ data: { token } }),
    enabled: Boolean(user),
    retry: false,
  });

  const accept = async () => {
    setSubmitting(true);
    try {
      const result = await redeem({ data: { token } });
      setPending(result.pendingApproval);
      setVerification(result.verificationRequired);
      setParentId(result.parentId);
      setDone(true);
      toast.success(
        result.verificationRequired
          ? "Sent. BallaCity will verify your parent or guardian first."
          : result.pendingApproval
            ? "Sent. Your current parent or guardian needs to approve it."
            : "You're connected to your parent or guardian.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not accept that invitation.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return null;

  if (!user) {
    return (
      <Shell>
        <h1 className="page-title">Sign in to accept</h1>
        <p className="mt-2 page-subtitle">
          Sign in (or create your account), add your date of birth, then open this link again.
        </p>
        <Link
          to="/auth"
          search={{ next: `/family/join/${token}` }}
          className="mt-4 inline-flex rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
        >
          Sign in
        </Link>
      </Shell>
    );
  }

  const cancel = async () => {
    if (!parentId) return;
    setSubmitting(true);
    try {
      await withdraw({ data: { parentId } });
      setCancelled(true);
      toast.success("Cancelled. Nobody was connected.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel that request.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Shell>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-lime" />
          <h1 className="page-title">
            {cancelled
              ? "Request cancelled"
              : verification
                ? "Waiting for verification"
                : pending
                  ? "Waiting for approval"
                  : "You're all set"}
          </h1>
        </div>
        <p className="mt-2 page-subtitle">
          {cancelled
            ? "Nobody was connected to your account."
            : verification
              ? "BallaCity checks every new parent or guardian before they can see or change anything on your account. Nothing changes until we verify them."
              : pending
                ? "Your current parent or guardian has to approve this new connection. Nothing changes until they do."
                : "Your parent or guardian is connected and can manage your safety settings."}
        </p>
        {pending && !cancelled && parentId ? (
          <Button
            variant="outline"
            className="mt-4 w-full"
            disabled={submitting}
            onClick={() => void cancel()}
          >
            {submitting ? "Cancelling…" : "I don't know this person: cancel"}
          </Button>
        ) : null}
        <Button className="mt-4 w-full" onClick={() => void navigate({ to: "/settings" })}>
          Go to Settings
        </Button>
      </Shell>
    );
  }

  const state = query.data?.state;

  return (
    <Shell>
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-muted-foreground" />
        <h1 className="page-title">Family invitation</h1>
      </div>

      {query.isLoading ? (
        <p className="mt-3 page-subtitle">Checking your invitation…</p>
      ) : state === "pending" ? (
        <>
          <p className="mt-3 text-sm">
            {query.data?.parentName ?? "A parent or guardian"} invited you as their{" "}
            {query.data?.relationship === "guardian" ? "dependent" : "minor"}
            {query.data?.childName ? ` (${query.data.childName})` : ""}.
          </p>
          <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
            <li>
              • They can see and change your safety settings — messaging, video visibility, games.
            </li>
            <li>• They can request your data or ask us to delete your account.</li>
            <li>
              • BallaCity verifies a new parent or guardian first. They get no access until then.
            </li>
            <li>
              • If you're under 13, their consent is recorded once they are verified, and your
              account turns on then.
            </li>
          </ul>
          <Button className="mt-4 w-full" disabled={submitting} onClick={() => void accept()}>
            {submitting ? "Connecting…" : "Accept invitation"}
          </Button>
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            {CHILD_POLICY_DISCLAIMER}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {state === "expired"
            ? "This invitation has expired. Ask your parent or guardian for a new link."
            : state === "revoked"
              ? "This invitation was cancelled."
              : state === "redeemed"
                ? "This invitation was already used."
                : "This invitation link isn't valid."}
        </p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-shell-narrow py-4">
      <div className="rounded-2xl border border-border bg-surface p-5">{children}</div>
    </div>
  );
}
