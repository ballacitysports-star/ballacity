import { createFileRoute } from "@tanstack/react-router";
import { CreateTrainerWizard } from "@/components/create/CreateTrainerWizard";
import { AccountTypeGate } from "@/components/AccountTypeGate";

export const Route = createFileRoute("/trainers/create")({
  head: () => ({ meta: [{ title: "Create a trainer profile — OpenRun" }] }),
  component: () => (
    <AccountTypeGate requires="trainer">
      <CreateTrainerWizard />
    </AccountTypeGate>
  ),
});
