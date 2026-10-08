import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { BackHeader } from "@/components/layout/BackHeader";
import { pageHead } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import { listingsCheck } from "@/lib/listings.functions";
import { ListingsClaimsPanel } from "@/components/admin/ListingsClaimsPanel";

export const Route = createFileRoute("/admin/listings")({
  head: () =>
    pageHead({
      path: "/admin/listings",
      title: "Listings — ballaCity Admin",
      description: "List teams and gyms that have no owner yet, and review ownership claims.",
      noindex: true,
    }),
  ssr: false,
  component: ListingsPage,
});

function ListingsPage() {
  const navigate = useNavigate();
  const check = useServerFn(listingsCheck);
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

  const { data: access, isLoading } = useQuery({
    queryKey: ["listings-check"],
    queryFn: () => check({}),
    enabled: authReady && hasSession,
  });

  useEffect(() => {
    if (authReady && !hasSession) {
      navigate({ to: "/auth" });
      return;
    }
    if (!isLoading && access && !access.isModerator) {
      toast.error("Moderator access required");
      navigate({ to: "/" });
    }
  }, [access, isLoading, authReady, hasSession, navigate]);

  if (!authReady || isLoading)
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!access?.isModerator) return null;

  return (
    <div className="min-h-dvh">
      <BackHeader title="Listings" fallbackTo="/admin" />
      <div className="page-shell space-y-4 py-4 sm:py-6">
        <ListingsClaimsPanel />
      </div>
    </div>
  );
}
