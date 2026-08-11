import { createFileRoute } from "@tanstack/react-router";
import { CreateOrgWizard } from "@/components/CreateOrgWizard";
import { AccountTypeGate } from "@/components/AccountTypeGate";
import { FinishSetupNotice } from "@/components/FinishSetupNotice";

export const Route = createFileRoute("/teams/create")({
  validateSearch: (search: Record<string, unknown>): { finish?: number } => ({
    finish: search.finish ? 1 : undefined,
  }),
  head: () => ({ meta: [{ title: "Create a team — OpenRun" }] }),
  component: CreateTeamPage,
});

function CreateTeamPage() {
  const { finish } = Route.useSearch();
  return (
    <AccountTypeGate requires="team">
      {finish ? (
        <div className="mx-auto w-full max-w-md p-4 pb-0 sm:max-w-2xl lg:max-w-5xl">
          <FinishSetupNotice kind="team" />
        </div>
      ) : null}
      <CreateOrgWizard kind="team" />
    </AccountTypeGate>
  );
}
