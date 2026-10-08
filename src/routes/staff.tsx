import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { ShieldCheck } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { useAuth } from "@/hooks/use-auth";
import { useStaffAccess } from "@/hooks/use-staff-access";
import { Button } from "@/components/ui/button";
import { staffDashboards, staffHomeFor, staffTierOf, STAFF_TIER_LABEL } from "@/lib/staff";

export const Route = createFileRoute("/staff")({
  head: () =>
    pageHead({
      path: "/staff",
      title: "Staff sign-in — ballaCity",
      description: "Staff sign-in for ballaCity.",
      noindex: true,
    }),
  validateSearch: (s: Record<string, unknown>) =>
    s.choose === true || s.choose === "1" ? { choose: true } : {},
  ssr: false,
  component: StaffPage,
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="page-shell grid min-h-dvh place-items-center py-10">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-surface-2">
          <ShieldCheck className="h-6 w-6" aria-hidden />
        </div>
        {children}
      </div>
    </main>
  );
}

/**
 * One sign-in for every staff tier. Signed-out visitors get a single button
 * into the normal sign-in; once signed in, the account is dispatched to the
 * dashboard for its highest tier (`?choose=1` shows all of them instead).
 */
function StaffPage() {
  const router = useRouter();
  const { choose } = Route.useSearch();
  const { user, loading: authLoading } = useAuth();
  const { access, loading } = useStaffAccess();
  const home = staffHomeFor(access);
  const tier = staffTierOf(access);

  useEffect(() => {
    if (!user || loading || !home || choose) return;
    void router.navigate({ to: home as never, replace: true });
  }, [user, loading, home, choose, router]);

  if (authLoading || (user && loading)) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground" role="status">
          Checking your staff access…
        </p>
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <h1 className="page-title">Staff sign-in</h1>
        <p className="page-subtitle">
          Sign in once and we&rsquo;ll take you to the right dashboard for your role.
        </p>
        <Button asChild className="w-full">
          <Link to="/auth" search={{ next: "/staff" }}>
            Sign in as staff
          </Link>
        </Button>
      </Shell>
    );
  }

  if (!tier) {
    return (
      <Shell>
        <h1 className="page-title">No staff access</h1>
        <p className="page-subtitle">
          This account doesn&rsquo;t have a staff role. If that&rsquo;s unexpected, ask a superadmin
          to grant one.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link to="/">Back to app</Link>
        </Button>
      </Shell>
    );
  }

  if (choose) {
    return (
      <Shell>
        <h1 className="page-title">Choose a dashboard</h1>
        <p className="page-subtitle">Signed in as {STAFF_TIER_LABEL[tier]}.</p>
        <div className="space-y-2 text-left">
          {staffDashboards(access).map((d) => (
            <Link
              key={d.tier}
              to={d.to}
              className="block rounded-xl border border-border bg-surface p-3 hover:bg-surface-2"
            >
              <span className="block text-sm font-medium">{d.label}</span>
              <span className="block text-xs text-muted-foreground">{d.description}</span>
            </Link>
          ))}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-sm text-muted-foreground" role="status">
        Opening your dashboard…
      </p>
    </Shell>
  );
}
