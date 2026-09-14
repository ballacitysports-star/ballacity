import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { LEGAL_DOCUMENTS, effectiveVersion, parseLegalContent } from "@/lib/legal-documents";
import { getPublishedLegalDocuments } from "@/lib/legal-documents.functions";
import { LegalDocumentBody } from "@/components/legal/LegalDocumentBody";
import { LegalPageFallback, LegalPageHeader } from "@/components/legal/LegalPageChrome";

const SHORT_TITLE = LEGAL_DOCUMENTS.terms.shortTitle;

export const Route = createFileRoute("/terms")({
  head: () =>
    pageHead({
      path: "/terms",
      title: "Terms of Service | BallaCity",
      description:
        "ballaCity's Terms of Service: account rules, game participation, peer-to-peer payments, content, and conduct.",
    }),
  // The published rows only supply the version history and any newer text; the
  // document itself is bundled, and `effectiveVersion` already falls back to
  // that when there is nothing published. So a failed fetch must not fail the
  // route — these terms have to stay readable, which is the whole reason
  // /terms is public in the first place.
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
      message="Couldn't load the Terms of Service."
      onRetry={reset}
    />
  ),
  notFoundComponent: () => (
    <LegalPageFallback title={SHORT_TITLE} message="This page could not be found." />
  ),
  component: TermsPage,
});

function TermsPage() {
  const { published } = Route.useLoaderData();
  const doc = LEGAL_DOCUMENTS.terms;
  const version = effectiveVersion("terms", published);
  const history = published
    .filter((p) => p.document_type === "terms")
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
          <Link to="/privacy" className="text-lime underline">
            Privacy Policy
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
