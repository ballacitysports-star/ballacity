import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { AgeGateScreen } from "@/components/onboarding/AgeGateScreen";

export const Route = createFileRoute("/onboarding/age")({
  head: () =>
    pageHead({
      path: "/onboarding/age",
      title: "Add your date of birth — ballaCity",
      description:
        "ballaCity asks for your date of birth so we can set the right safety, privacy and account experience.",
      noindex: true,
    }),
  ssr: false,
  component: AgeGatePage,
});

function AgeGatePage() {
  return <AgeGateScreen />;
}
