import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { CreateTrainerWizard } from "@/components/create/CreateTrainerWizard";
import { AccountTypeGate } from "@/components/AccountTypeGate";
import { FinishSetupNotice } from "@/components/FinishSetupNotice";

export const Route = createFileRoute("/trainers/create")({
  head: () =>
    pageHead({
      path: "/trainers/create",
      title: "Create a trainer profile — ballaCity",
      description: "Set up your trainer profile to offer sessions and manage availability.",
      noindex: true,
    }),
  validateSearch: (search: Record<string, unknown>): { finish?: number } => ({
    finish: search.finish ? 1 : undefined,
  }),
  component: CreateTrainerPage,
});

function CreateTrainerPage() {
  const { finish } = Route.useSearch();
  return (
    <AccountTypeGate requires="trainer">
      {finish ? (
        <div className="page-shell pt-4 pb-0">
          <FinishSetupNotice kind="trainer" />
        </div>
      ) : null}
      <CreateTrainerWizard />
    </AccountTypeGate>
  );
}
