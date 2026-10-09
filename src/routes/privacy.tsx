import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { LEGAL_DOCUMENTS, effectiveVersion, parseLegalContent } from "@/lib/legal-documents";
import { getPublishedLegalDocuments } from "@/lib/legal-documents.functions";
import { LegalDocumentBody } from "@/components/legal/LegalDocumentBody";
import { LegalPageFallback, LegalPageHeader } from "@/components/legal/LegalPageChrome";

const SHORT_TITLE = LEGAL_DOCUMENTS.privacy.shortTitle;

export const Route = createFileRoute("/privacy")({
  head: () =>
    pageHead({
      path: "/privacy",
      title: "Privacy Policy | BallaCity",
      description:
        "BallaCity's Privacy Policy: what personal data we collect, how it's used and shared, and the privacy controls you have.",
    }),
  // The published rows only supply the version history and any newer text; the
  // policy itself is bundled, and `effectiveVersion` already falls back to that
  // when there is nothing published. So a failed fetch must not fail the route
  // — this policy has to stay readable, which is the whole reason /privacy is
  // public in the first place.
  loader: async () => {
    try {
      return { published: await getPublishedLegalDocuments() };
    } catch {
      return { published: [] };
    }
  },
  errorComponent: ({ reset }) => (
    <LegalPageFallback
      title={SHORT_TITLE}
      message="Couldn't load the Privacy Policy."
      onRetry={reset}
    />
  ),
  notFoundComponent: () => (
    <LegalPageFallback title={SHORT_TITLE} message="This page could not be found." />
  ),
  component: PrivacyPage,
});

function PrivacyPage() {
  const { published } = Route.useLoaderData();
  const doc = LEGAL_DOCUMENTS.privacy;
  const version = effectiveVersion("privacy", published);
  const history = published
    .filter((p) => p.document_type === "privacy")
    .map((p) => ({
      version: p.version,
      effectiveDate: p.effective_date,
      material: p.requires_reacceptance,
      summary: p.summary,
      sections: parseLegalContent(p.content),
    }));

  return (
    <div className="min-h-dvh bg-background">
      <LegalPageHeader title={doc.shortTitle} />
      <main className="page-shell-prose py-6 pb-24">
        <LegalDocumentBody
          doc={doc}
          version={version}
          history={history.length > 0 ? history : undefined}
        />
        <p className="mt-8 text-xs text-muted-foreground">
          Also see the{" "}
          <Link to="/terms" className="text-lime underline">
            Terms of Service
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
