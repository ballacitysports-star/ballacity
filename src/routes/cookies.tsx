import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { LEGAL_DOCUMENTS } from "@/lib/legal-documents";
import { LegalPageFallback } from "@/components/legal/LegalPageChrome";
import { PublishedLegalPage } from "@/components/legal/PublishedLegalPage";
import { loadPublishedLegalDocuments } from "@/lib/legal-documents.functions";

const SHORT_TITLE = LEGAL_DOCUMENTS.cookie_preferences.shortTitle;

export const Route = createFileRoute("/cookies")({
  head: () =>
    pageHead({
      path: "/cookies",
      title: "Cookies & Local Storage — BallaCity",
      description:
        "What BallaCity stores in your browser to keep you signed in and remember preferences, and how to clear it.",
    }),
  loader: loadPublishedLegalDocuments,
  errorComponent: ({ reset }) => (
    <LegalPageFallback
      title={SHORT_TITLE}
      message="Couldn't load the Cookies notice."
      onRetry={reset}
    />
  ),
  notFoundComponent: () => (
    <LegalPageFallback title={SHORT_TITLE} message="This page could not be found." />
  ),
  component: CookiesPage,
});

function CookiesPage() {
  const { published } = Route.useLoaderData();
  return (
    <PublishedLegalPage
      type="cookie_preferences"
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
