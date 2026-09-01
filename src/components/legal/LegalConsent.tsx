import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { LEGAL_DOCUMENT_LIST, effectiveVersion, type LegalDocumentType } from "@/lib/legal-documents";
import { usePublishedLegalDocuments } from "@/lib/legal-consent";

export type LegalConsentValue = Record<LegalDocumentType, boolean>;

export const emptyConsentValue: LegalConsentValue = { terms: false, privacy: false };

export function allAccepted(value: LegalConsentValue, types?: LegalDocumentType[]) {
  const list = types ?? LEGAL_DOCUMENT_LIST.map((d) => d.type);
  return list.every((t) => value[t]);
}

/**
 * Reusable, never pre-checked legal consent control. Used by signup and by the
 * re-acceptance flow so the wording, versions, and links stay in one place.
 */
export function LegalConsent({
  value,
  onChange,
  types,
  disabled,
  className,
}: {
  value: LegalConsentValue;
  onChange: (next: LegalConsentValue) => void;
  /** Limit to specific documents (defaults to all). */
  types?: LegalDocumentType[];
  disabled?: boolean;
  className?: string;
}) {
  const { published } = usePublishedLegalDocuments();
  const docs = LEGAL_DOCUMENT_LIST.filter((d) => !types || types.includes(d.type));

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      {docs.map((doc) => {
        const v = effectiveVersion(doc.type, published);
        const checked = !!value[doc.type];
        const id = `legal-consent-${doc.type}`;
        return (
          <div
            key={doc.type}
            className="flex items-start gap-3 rounded-2xl border border-border bg-surface px-3 py-3"
          >
            <button
              type="button"
              id={id}
              role="checkbox"
              aria-checked={checked}
              disabled={disabled}
              onClick={() => onChange({ ...value, [doc.type]: !checked })}
              className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border transition disabled:opacity-50 ${
                checked ? "border-lime bg-lime text-primary-foreground" : "border-border bg-background"
              }`}
            >
              {checked ? <Check className="h-4 w-4" aria-hidden /> : null}
            </button>
            <label htmlFor={id} className="min-w-0 flex-1 text-xs leading-relaxed">
              <span className="text-foreground">
                I have read and agree to the{" "}
                <Link
                  to={doc.path}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-lime underline"
                >
                  {doc.title}
                </Link>
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Version {v.version} · effective {v.effectiveDate}
              </span>
            </label>
          </div>
        );
      })}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        These documents are placeholder drafts pending legal review. OpenRun does not process
        payments or supervise games.
      </p>
    </div>
  );
}
