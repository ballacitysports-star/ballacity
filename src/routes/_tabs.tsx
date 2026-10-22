import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PendingSetupRedirect } from "@/components/PendingSetupRedirect";
import { LegalReacceptGate } from "@/components/legal/LegalReacceptGate";
import { ChildConsentGate } from "@/components/child/ChildConsentGate";
import { DiscoverTabs } from "@/components/navigation/DiscoverTabs";

export const Route = createFileRoute("/_tabs")({
  component: TabsLayout,
});

function TabsLayout() {
  return (
    <div className="min-h-dvh pb-[calc(env(safe-area-inset-bottom)+6rem)] pt-[env(safe-area-inset-top)]">
      <PendingSetupRedirect />
      <LegalReacceptGate />
      <ChildConsentGate />
      <DiscoverTabs />
      <Outlet />
    </div>
  );
}
