import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { LEGAL_DOCUMENTS, currentVersion } from "@/lib/legal-documents";
import { LegalDocumentBody } from "@/components/legal/LegalDocumentBody";

export const Route = createFileRoute("/terms")({
  head: () =>
    pageHead({
      path: "/terms",
      title: "Terms of Service — OpenRun",
      description:
        "OpenRun's Terms of Service: account rules, game participation, peer-to-peer payments, content, and conduct.",
    }),
  component: TermsPage,
});

function TermsPage() {
  const doc = LEGAL_DOCUMENTS.terms;
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-2 py-2.5 backdrop-blur">
        <Link to="/" className="rounded-full p-2 hover:bg-surface" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="text-sm font-medium">{doc.shortTitle}</span>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 pb-24">
        <LegalDocumentBody doc={doc} version={currentVersion("terms")} />
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
