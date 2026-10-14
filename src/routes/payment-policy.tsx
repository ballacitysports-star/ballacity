import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { LEGAL_DOCUMENTS } from "@/lib/legal-documents";
import { LegalPageFallback } from "@/components/legal/LegalPageChrome";
import { PublishedLegalPage } from "@/components/legal/PublishedLegalPage";
import { loadPublishedLegalDocuments } from "@/lib/legal-documents.functions";

const SHORT_TITLE = LEGAL_DOCUMENTS.payment_policy.shortTitle;

export const Route = createFileRoute("/payment-policy")({
  head: () =>
    pageHead({
      path: "/payment-policy",
      title: "Payment Policy — BallaCity",
      description:
        "How game fees work on BallaCity: players pay hosts directly, BallaCity never holds funds, and refunds are handled between player and host.",
    }),
  loader: loadPublishedLegalDocuments,
  errorComponent: ({ reset }) => (
    <LegalPageFallback
      title={SHORT_TITLE}
      message="Couldn't load the Payment Policy."
      onRetry={reset}
    />
  ),
  notFoundComponent: () => (
    <LegalPageFallback title={SHORT_TITLE} message="This page could not be found." />
  ),
  component: PaymentPolicyPage,
});

function PaymentPolicyPage() {
  const { published } = Route.useLoaderData();
  return (
    <PublishedLegalPage
      type="payment_policy"
      published={published}
      footer={
        <>
          Also see the{" "}
          <Link to="/terms" className="text-lime underline">
            Terms of Service
          </Link>
          .
        </>
      }
    />
  );
}
