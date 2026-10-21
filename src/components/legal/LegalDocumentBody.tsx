import { AlertTriangle } from "lucide-react";
import {
  LEGAL_REVIEW_BANNER,
  LEGAL_REVIEW_NOTE,
  type LegalDocument,
  type LegalDocumentVersion,
  type LegalSection,
} from "@/lib/legal-documents";

export function LegalReviewBanner() {
  return (
    <div className="rounded-2xl border border-coral/40 bg-coral/10 p-3 text-xs leading-relaxed">
      <div className="mb-1 flex items-center gap-2 font-bold text-foreground">
        <AlertTriangle className="h-4 w-4 text-coral" aria-hidden />
        {LEGAL_REVIEW_BANNER}
      </div>
      <p className="text-muted-foreground">{LEGAL_REVIEW_NOTE}</p>
    </div>
  );
}

export function LegalDocumentBody({
  doc,
  version,
  history,
}: {
  doc: LegalDocument;
  version: LegalDocumentVersion;
  /** Previous versions to list (defaults to the bundled registry history). */
  history?: LegalDocumentVersion[];
}) {
  const versions = history ?? doc.versions;
  // effectiveVersion() sets `content` only when a published database row was
  // found, so its absence means we are rendering the bundled placeholder copy —
  // which is the only thing the review warning should ever sit above.
  const isPlaceholder = !("content" in version) || !version.content;
  return (
    <article className="space-y-5">
      {isPlaceholder ? <LegalReviewBanner /> : null}
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{doc.title}</h1>
        <p className="text-xs text-muted-foreground">
          Version {version.version} · Effective {version.effectiveDate}
          {version.material ? " · Requires acceptance" : ""}
        </p>
        <p className="text-sm text-muted-foreground">{version.summary}</p>
      </header>
      <LegalSections sections={version.sections} />
      {versions.length > 1 ? (
        <section className="space-y-2 border-t border-border pt-4">
          <h2 className="text-sm font-semibold">Version history</h2>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {versions.map((v) => (
              <li key={v.version}>
                <span className="font-semibold text-foreground">{v.version}</span> — effective{" "}
                {v.effectiveDate}
                {v.material ? " (material change)" : ""}: {v.summary}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

/** A document's sections: headings, paragraphs and bullet lists in source order. */
export function LegalSections({ sections }: { sections: LegalSection[] }) {
  return (
    <>
      {sections.map((s) => (
        <section key={s.heading} className="space-y-2">
          <h2 className="text-base font-semibold">{s.heading}</h2>
          {s.blocks?.length
            ? s.blocks.map((b, i) =>
                b.kind === "ul" ? (
                  <ul
                    key={i}
                    className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground"
                  >
                    {b.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                    {b.text}
                  </p>
                ),
              )
            : s.body.map((p, i) => (
                <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                  {p}
                </p>
              ))}
        </section>
      ))}
    </>
  );
}
