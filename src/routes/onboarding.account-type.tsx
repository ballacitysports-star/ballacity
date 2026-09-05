import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { AccountTypeScreen } from "@/components/onboarding/AccountTypeScreen";

export const Route = createFileRoute("/onboarding/account-type")({
  head: () =>
    pageHead({
      path: "/onboarding/account-type",
      title: "Choose your profile type — ballaCity",
      description: "Start as a player, team, trainer, or gym — you can add more profiles later.",
      noindex: true,
    }),
  component: OnboardingAccountTypePage,
});

function OnboardingAccountTypePage() {
  return <AccountTypeScreen />;
}
