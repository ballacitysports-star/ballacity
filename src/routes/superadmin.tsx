import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { pageHead } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import { superadminCheck } from "@/lib/superadmin.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OverviewTab } from "@/components/superadmin/OverviewTab";
import { UsersTab } from "@/components/superadmin/UsersTab";
import { ModerationTab } from "@/components/superadmin/ModerationTab";
import { ImagesTab } from "@/components/superadmin/ImagesTab";

import { PaymentsTab } from "@/components/superadmin/PaymentsTab";
import { MonetizationTab } from "@/components/superadmin/MonetizationTab";
import { OpsTab } from "@/components/superadmin/OpsTab";
import { AuditTab } from "@/components/superadmin/AuditTab";
import { YouthTab } from "@/components/superadmin/YouthTab";
import { AttentionStrip } from "@/components/superadmin/AttentionStrip";
import { ReelsWorkerTab } from "@/components/superadmin/ReelsWorkerTab";
import { ListingsClaimsPanel } from "@/components/admin/ListingsClaimsPanel";
import { LegalPublishingPanel } from "@/components/admin/LegalPublishingPanel";

export const Route = createFileRoute("/superadmin")({
  head: () =>
    pageHead({
      path: "/superadmin",
      title: "Superadmin — ballaCity",
      description: "Internal ballaCity control center.",
      noindex: true,
    }),
  ssr: false,
  component: SuperadminPage,
});

function SuperadminPage() {
  const navigate = useNavigate();
  const check = useServerFn(superadminCheck);
  const [authReady, setAuthReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasSession(!!session);
      setAuthReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["superadmin-check"],
    queryFn: () => check({}),
    enabled: authReady && hasSession,
    retry: 2,
    retryDelay: (n) => 800 * (n + 1),
  });

  useEffect(() => {
    if (authReady && !hasSession) {
      navigate({ to: "/auth" });
      return;
    }
    if (!isLoading && data && !data.isSuperadmin) {
      toast.error("Superadmin access required");
      navigate({ to: "/" });
    }
  }, [data, isLoading, navigate, authReady, hasSession]);

  if (!authReady || isLoading)
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (isError)
    return (
      <div className="page-shell space-y-3 py-6">
        <p className="text-sm text-muted-foreground">We couldn't verify your access right now.</p>
        <Button size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Retrying…" : "Try again"}
        </Button>
      </div>
    );
  if (!data?.isSuperadmin) return null;

  return (
    <div className="page-shell min-h-dvh space-y-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="page-title flex items-center gap-2">
            Control center
            <Badge variant="destructive">superadmin</Badge>
          </h1>
          <p className="page-subtitle">
            Full control over accounts, content, payments and configuration. Every action is
            reversible and logged.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/admin">Admin panel</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/">Back to app</Link>
          </Button>
        </div>
      </div>

      <AttentionStrip onNavigate={setTab} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users &amp; profiles</TabsTrigger>
          <TabsTrigger value="moderation">Content</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="monetization">Monetization</TabsTrigger>
          <TabsTrigger value="ops">Ops &amp; config</TabsTrigger>
          <TabsTrigger value="youth">Youth &amp; age</TabsTrigger>
          <TabsTrigger value="listings">Listings &amp; claims</TabsTrigger>
          <TabsTrigger value="legal">Legal</TabsTrigger>
          <TabsTrigger value="reels">Reels worker</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-3">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="users" className="pt-3">
          <UsersTab currentUserId={data.userId} />
        </TabsContent>
        <TabsContent value="moderation" className="pt-3">
          <ModerationTab />
        </TabsContent>
        <TabsContent value="images" className="pt-3">
          <ImagesTab />
        </TabsContent>

        <TabsContent value="payments" className="pt-3">
          <PaymentsTab />
        </TabsContent>
        <TabsContent value="monetization" className="pt-3">
          <MonetizationTab />
        </TabsContent>
        <TabsContent value="ops" className="pt-3">
          <OpsTab />
        </TabsContent>
        <TabsContent value="youth" className="pt-3">
          <YouthTab />
        </TabsContent>
        <TabsContent value="listings" className="pt-3">
          <ListingsClaimsPanel />
        </TabsContent>
        <TabsContent value="legal" className="pt-3">
          <LegalPublishingPanel embedded />
        </TabsContent>
        <TabsContent value="reels" className="pt-3">
          <ReelsWorkerTab />
        </TabsContent>
        <TabsContent value="audit" className="pt-3">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
