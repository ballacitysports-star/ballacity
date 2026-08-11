import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/games/$gameId")({
  component: GamesGameIdLayout,
});

function GamesGameIdLayout() {
  return <Outlet />;
}
