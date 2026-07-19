import { createFileRoute } from "@tanstack/react-router";
import { CreateOrgWizard } from "@/components/CreateOrgWizard";

export const Route = createFileRoute("/trainers/create")({
  head: () => ({ meta: [{ title: "Create a trainer profile — OpenRun" }] }),
  component: () => <CreateOrgWizard kind="coach" />,
});
