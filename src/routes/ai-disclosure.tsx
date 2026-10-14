import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { LEGAL_DOCUMENTS } from "@/lib/legal-documents";
import { LegalPageFallback } from "@/components/legal/LegalPageChrome";
import { PublishedLegalPage } from "@/components/legal/PublishedLegalPage";
import { loadPublishedLegalDocuments } from "@/lib/legal-documents.functions";

const SHORT_TITLE = LEGAL_DOCUMENTS.ai_disclosure.shortTitle;

export const Route = createFileRoute("/ai-disclosure")({
  head: () =>
    pageHead({
      path: "/ai-disclosure",
      title: "AI & Video Disclosure — BallaCity",
      description:
        "How BallaCity's AI features analyze highlight clips, what they can't do, and how to turn AI processing off.",
    }),
  loader: loadPublishedLegalDocuments,
  errorComponent: ({ reset }) => (
    <LegalPageFallback
      title={SHORT_TITLE}
      message="Couldn't load the AI & Video Disclosure."
      onRetry={reset}
    />
  ),
  notFoundComponent: () => (
    <LegalPageFallback title={SHORT_TITLE} message="This page could not be found." />
  ),
  component: AiDisclosurePage,
});

function AiDisclosurePage() {
  const { published } = Route.useLoaderData();
  return (
    <PublishedLegalPage
      type="ai_disclosure"
      published={published}
      footer={
        <>
          Also see the{" "}
          <Link to="/privacy" className="text-lime underline">
            Privacy Policy
          </Link>
          .
        </>
      }
    />
  );
}
