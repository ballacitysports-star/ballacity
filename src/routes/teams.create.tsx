import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { CreateOrgWizard } from "@/components/CreateOrgWizard";
import { AccountTypeGate } from "@/components/AccountTypeGate";
import { FinishSetupNotice } from "@/components/FinishSetupNotice";

export const Route = createFileRoute("/teams/create")({
  head: () =>
    pageHead({
      path: "/teams/create",
      title: "Create a team profile — ballaCity",
      description: "Set up your team on ballaCity to host games and manage your roster.",
      noindex: true,
    }),
  validateSearch: (search: Record<string, unknown>): { finish?: number } => ({
    finish: search.finish ? 1 : undefined,
  }),
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
