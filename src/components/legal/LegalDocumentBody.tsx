import { AlertTriangle } from "lucide-react";
import {
  LEGAL_REVIEW_BANNER,
  LEGAL_REVIEW_NOTE,
  type LegalDocument,
  type LegalDocumentVersion,
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
}: {
  doc: LegalDocument;
  version: LegalDocumentVersion;
}) {
  return (
    <article className="space-y-5">
      <LegalReviewBanner />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{doc.title}</h1>
        <p className="text-xs text-muted-foreground">
          Version {version.version} · Effective {version.effectiveDate}
          {version.material ? " · Requires acceptance" : ""}
        </p>
        <p className="text-sm text-muted-foreground">{version.summary}</p>
      </header>
      {version.sections.map((s) => (
        <section key={s.heading} className="space-y-2">
          <h2 className="text-base font-semibold">{s.heading}</h2>
          {s.body.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-muted-foreground">
              {p}
            </p>
          ))}
        </section>
      ))}
      {doc.versions.length > 1 ? (
        <section className="space-y-2 border-t border-border pt-4">
          <h2 className="text-sm font-semibold">Version history</h2>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {doc.versions.map((v) => (
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
