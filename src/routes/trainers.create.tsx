import { createFileRoute } from "@tanstack/react-router";
import { CreateTrainerWizard } from "@/components/create/CreateTrainerWizard";

export const Route = createFileRoute("/trainers/create")({
  head: () => ({ meta: [{ title: "Create a trainer profile — OpenRun" }] }),
  component: () => <CreateTrainerWizard />,
});
