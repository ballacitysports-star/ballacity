import { createFileRoute } from "@tanstack/react-router";
import { CreateOrgWizard } from "@/components/CreateOrgWizard";
import { AccountTypeGate } from "@/components/AccountTypeGate";

export const Route = createFileRoute("/teams/create")({
  head: () => ({ meta: [{ title: "Create a team — OpenRun" }] }),
  component: () => (
    <AccountTypeGate requires="team">
      <CreateOrgWizard kind="team" />
    </AccountTypeGate>
  ),
});
