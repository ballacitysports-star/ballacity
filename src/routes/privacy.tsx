import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { LEGAL_DOCUMENTS, currentVersion } from "@/lib/legal-documents";
import { LegalDocumentBody } from "@/components/legal/LegalDocumentBody";

export const Route = createFileRoute("/privacy")({
  head: () =>
    pageHead({
      path: "/privacy",
      title: "Privacy Policy — OpenRun",
      description:
        "OpenRun's Privacy Policy: what personal data we collect, how it's used and shared, and the privacy controls you have.",
    }),
  component: PrivacyPage,
});

function PrivacyPage() {
  const doc = LEGAL_DOCUMENTS.privacy;
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-2 py-2.5 backdrop-blur">
        <Link to="/" className="rounded-full p-2 hover:bg-surface" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="text-sm font-medium">{doc.shortTitle}</span>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 pb-24">
        <LegalDocumentBody doc={doc} version={currentVersion("privacy")} />
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
