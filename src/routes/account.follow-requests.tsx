import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { withRequireAuth } from "@/components/RequireAuth";
import { BackHeader } from "@/components/layout/BackHeader";
import { FollowRequestsPanel } from "@/components/follow/FollowRequestsPanel";
import { LoadingState } from "@/components/ui/loading-state";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/account/follow-requests")({
  head: () =>
    pageHead({
      path: "/account/follow-requests",
      title: "Followers and requests — BallaCity",
      description: "Approve follow requests and remove followers.",
      noindex: true,
    }),
  component: withRequireAuth(FollowRequestsPage),
});

function FollowRequestsPage() {
  const { user } = useAuth();
  // The database's own answer to "how old am I", not the app's coarser category:
  // under 16 only a verified guardian can answer follow requests.
  const cohort = useQuery({
    queryKey: ["my-age-cohort"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.rpc("my_age_cohort" as never);
      return typeof data === "string" ? data : "unknown";
    },
  });
  const underSixteen = cohort.data === "child_under_13" || cohort.data === "teen_13_15";

  return (
    <div className="min-h-dvh bg-background pb-24">
      <BackHeader title="Followers and requests" fallbackTo="/account/privacy" />
      <main className="page-shell-narrow space-y-4 px-4 pt-4">
        {!user || cohort.isLoading ? (
          <LoadingState />
        ) : underSixteen ? (
          <div className="rounded-xl border border-primary/40 bg-primary/10 p-3">
            <p className="text-sm font-medium">A parent or guardian approves your followers</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Because you&apos;re under 16, only a verified parent or guardian can approve follow
              requests for your account. They can review them in the Parent Center.
            </p>
          </div>
        ) : (
          <FollowRequestsPanel targetUserId={user.id} showFollowers />
        )}
      </main>
    </div>
  );
}
