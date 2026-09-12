import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { LEGAL_DOCUMENTS, effectiveVersion, parseLegalContent } from "@/lib/legal-documents";
import { getPublishedLegalDocuments } from "@/lib/legal-documents.functions";
import { LegalDocumentBody } from "@/components/legal/LegalDocumentBody";
import { LegalPageFallback, LegalPageHeader } from "@/components/legal/LegalPageChrome";

const SHORT_TITLE = LEGAL_DOCUMENTS.cookie_preferences.shortTitle;

export const Route = createFileRoute("/cookies")({
  head: () =>
    pageHead({
      path: "/cookies",
      title: "Cookies & Local Storage — ballaCity",
      description:
        "What ballaCity stores in your browser to keep you signed in and remember preferences, and how to clear it.",
    }),
  // The published rows only supply the version history and any newer text; the
  // document itself is bundled, and `effectiveVersion` already falls back to
  // that when there is nothing published. So a failed fetch must not fail the
  // route — this notice has to stay readable, which is the whole reason
  // /cookies is public in the first place.
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
  const doc = LEGAL_DOCUMENTS.cookie_preferences;
  const version = effectiveVersion("cookie_preferences", published);
  const history = published
    .filter((p) => p.document_type === "cookie_preferences")
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
