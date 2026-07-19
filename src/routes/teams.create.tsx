import { createFileRoute } from "@tanstack/react-router";
import { CreateOrgWizard } from "@/components/CreateOrgWizard";

export const Route = createFileRoute("/teams/create")({
  head: () => ({ meta: [{ title: "Create a team — OpenRun" }] }),
  component: () => <CreateOrgWizard kind="team" />,
});
