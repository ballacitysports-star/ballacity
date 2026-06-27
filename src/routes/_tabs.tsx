import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_tabs")({
  component: TabsLayout,
});

function TabsLayout() {
  return (
    <div className="min-h-dvh pb-[calc(env(safe-area-inset-bottom)+6rem)] pt-[env(safe-area-inset-top)]">
      <Outlet />
    </div>
  );
}
