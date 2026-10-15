import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { LEGAL_DOCUMENTS } from "@/lib/legal-documents";
import { LegalPageFallback } from "@/components/legal/LegalPageChrome";
import { PublishedLegalPage } from "@/components/legal/PublishedLegalPage";
import { loadPublishedLegalDocuments } from "@/lib/legal-documents.functions";

const SHORT_TITLE = LEGAL_DOCUMENTS.youth_policy.shortTitle;

export const Route = createFileRoute("/youth-policy")({
  head: () =>
    pageHead({
      path: "/youth-policy",
      title: "Youth & Minor Policy — BallaCity",
      description:
        "BallaCity's age requirements, parental consent, and the extra protections for younger players.",
    }),
  loader: loadPublishedLegalDocuments,
  errorComponent: ({ reset }) => (
    <LegalPageFallback
      title={SHORT_TITLE}
      message="Couldn't load the Youth & Minor Policy."
      onRetry={reset}
    />
  ),
  notFoundComponent: () => (
    <LegalPageFallback title={SHORT_TITLE} message="This page could not be found." />
  ),
  component: YouthPolicyPage,
});

function YouthPolicyPage() {
  const { published } = Route.useLoaderData();
  return (
    <PublishedLegalPage
      type="youth_policy"
      published={published}
      footer={
        <>
          Also see the{" "}
          <Link to="/safety/children" className="text-lime underline">
            Child Safety page
          </Link>
          .
        </>
      }
    />
  );
}
