import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldCheck, Users } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { useAuth } from "@/hooks/use-auth";
import { CHILD_POLICY_DISCLAIMER } from "@/lib/child-policy";
import { lookupMinorInvite, redeemMinorInvite } from "@/lib/family-invites.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/family/join/$token")({
  head: () =>
    pageHead({
      title: "Join your family on ballaCity",
      description:
        "Accept a parent or guardian invitation so they can manage your ballaCity safety settings.",
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
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const query = useQuery({
    queryKey: ["minor-invite", token],
    queryFn: () => lookup({ data: { token } }),
    enabled: Boolean(user),
    retry: false,
  });

  const accept = async () => {
    setSubmitting(true);
    try {
      await redeem({ data: { token } });
      setDone(true);
      toast.success("You're connected to your parent or guardian.");
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
        <h1 className="font-display text-xl font-bold">Sign in to accept</h1>
        <p className="mt-2 text-sm text-muted-foreground">
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

  if (done) {
    return (
      <Shell>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-lime" />
          <h1 className="font-display text-xl font-bold">You're all set</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Your parent or guardian is connected and can manage your safety settings.
        </p>
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
        <h1 className="font-display text-xl font-bold">Family invitation</h1>
      </div>

      {query.isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Checking your invitation…</p>
      ) : state === "pending" ? (
        <>
          <p className="mt-3 text-sm">
            {query.data?.parentName ?? "A parent or guardian"} invited you as their{" "}
            {query.data?.relationship === "guardian" ? "dependent" : "minor"}
            {query.data?.childName ? ` (${query.data.childName})` : ""}.
          </p>
          <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
            <li>• They can see and change your safety settings — messaging, video visibility, games.</li>
            <li>• They can request your data or ask us to delete your account.</li>
            <li>• If you're under 13, accepting also records their consent so your account turns on.</li>
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
    <div className="mx-auto w-full max-w-md p-4">
      <div className="rounded-2xl border border-border bg-surface p-5">{children}</div>
    </div>
  );
}
