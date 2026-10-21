import type { ReactNode } from "react";
import {
  LEGAL_DOCUMENTS,
  effectiveVersion,
  parseLegalContent,
  type LegalDocumentType,
  type PublishedLegalDocument,
} from "@/lib/legal-documents";
import { LegalDocumentBody } from "@/components/legal/LegalDocumentBody";
import { LegalPageHeader } from "@/components/legal/LegalPageChrome";

/** A legal page whose text an admin can publish, with the bundled copy as fallback. */
export function PublishedLegalPage({
  type,
  published,
  footer,
}: {
  type: LegalDocumentType;
  published: PublishedLegalDocument[];
  footer?: ReactNode;
}) {
  const doc = LEGAL_DOCUMENTS[type];
  const version = effectiveVersion(type, published);
  const history = published
    .filter((p) => p.document_type === type)
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
        {footer ? <div className="mt-8 text-xs text-muted-foreground">{footer}</div> : null}
      </main>
    </div>
  );
}
