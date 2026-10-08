import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { pageHead } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import { adminCheck } from "@/lib/admin.functions";
import { LegalPublishingPanel } from "@/components/admin/LegalPublishingPanel";

export const Route = createFileRoute("/admin/legal")({
  head: () =>
    pageHead({
      path: "/admin/legal",
      title: "Legal & Compliance — ballaCity Admin",
      description: "Manage versions of ballaCity's legal and policy documents.",
      noindex: true,
    }),
  ssr: false,
  component: AdminLegalPage,
});

function AdminLegalPage() {
  const navigate = useNavigate();
  const check = useServerFn(adminCheck);
  const [authReady, setAuthReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);

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

  const { data: adminData, isLoading: checking } = useQuery({
    queryKey: ["admin-check"],
    queryFn: () => check({}),
    enabled: authReady && hasSession,
  });

  useEffect(() => {
    if (authReady && !hasSession) {
      navigate({ to: "/auth" });
      return;
    }
    if (!checking && adminData && !adminData.isAdmin) {
      toast.error("Admin access required");
      navigate({ to: "/" });
    }
  }, [adminData, checking, authReady, hasSession, navigate]);

  if (!authReady || checking)
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!adminData?.isAdmin) return null;

  return <LegalPublishingPanel />;
}
