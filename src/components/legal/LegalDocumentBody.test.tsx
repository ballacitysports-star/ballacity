import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LegalDocumentBody } from "./LegalDocumentBody";
import {
  LEGAL_DOCUMENTS,
  LEGAL_REVIEW_BANNER,
  effectiveVersion,
  type PublishedLegalDocument,
} from "@/lib/legal-documents";

/**
 * The placeholder warning must sit above placeholder copy and nothing else.
 * Showing it over real published terms is what made visitors think the live
 * policies were still a draft.
 */
const publishedTerms: PublishedLegalDocument = {
  id: "1",
  document_type: "terms",
  title: "Terms of Service",
  version: "2026-09-11",
  content: "## 1. Real heading\nReal published body.\n\n- a bullet\n- another",
  summary: "Real summary.",
  requires_reacceptance: true,
  effective_date: "2026-09-11",
  published: true,
  published_at: "2026-09-11T00:00:00Z",
  archived_at: null,
};

const markup = (published: PublishedLegalDocument[]) =>
  renderToStaticMarkup(
    <LegalDocumentBody
      doc={LEGAL_DOCUMENTS.terms}
      version={effectiveVersion("terms", published)}
    />,
  );

describe("LegalDocumentBody", () => {
  it("hides the review banner when real published content is shown", () => {
    const html = markup([publishedTerms]);
    expect(html).not.toContain(LEGAL_REVIEW_BANNER);
    expect(html).toContain("Real published body.");
  });

  it("still shows the review banner over the bundled placeholder copy", () => {
    expect(markup([])).toContain(LEGAL_REVIEW_BANNER);
  });

  it("renders bullet lists from published content", () => {
    const html = markup([publishedTerms]);
    expect(html).toContain("<ul");
    expect(html).toContain("<li>a bullet</li>");
    expect(html).toContain("<li>another</li>");
  });
});
