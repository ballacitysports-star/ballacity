import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ChildConsentGate } from "@/components/child/ChildConsentGate";

export const Route = createFileRoute("/games/$gameId")({
  component: GamesGameIdLayout,
});

/**
 * The game page and its pay page live outside the tab layout, so the consent banner the
 * tabs show is mounted here too. Without it a minor whose account still needs a parent's
 * approval reached Join, got "A parent or guardian must approve…" and had no way on: the
 * banner's Start approval / Check status button is that way. It renders nothing for
 * everyone else.
 */
function GamesGameIdLayout() {
  return (
    <>
      <ChildConsentGate />
      <Outlet />
    </>
  );
}
