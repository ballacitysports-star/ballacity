import { createFileRoute, Link } from "@tanstack/react-router";
import { BackHeader } from "@/components/layout/BackHeader";
import { CheckCircle2, AlertCircle, FileText } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { pageHead } from "@/lib/seo";
import { useAuth } from "@/hooks/use-auth";
import { useAcceptLegal, useMyLegalConsents } from "@/lib/legal-consent";
import { LEGAL_DOCUMENT_LIST, effectiveVersion } from "@/lib/legal-documents";
import { LegalConsent, allAccepted, emptyConsentValue } from "@/components/legal/LegalConsent";
import { LegalReviewBanner } from "@/components/legal/LegalDocumentBody";

export const Route = createFileRoute("/account/legal")({
  head: () =>
    pageHead({
      path: "/account/legal",
      title: "Legal & Privacy — ballaCity",
      description:
        "Review the ballaCity Terms of Service and Privacy Policy and see your consent history.",
      noindex: true,
    }),
  component: LegalSettingsPage,
});

function LegalSettingsPage() {
  const { user } = useAuth();
  const { statuses, records, isLoading, published } = useMyLegalConsents();
  const accept = useAcceptLegal();
  const [value, setValue] = useState(emptyConsentValue);

  const outstanding = statuses.filter((s) => s.needsAcceptance).map((s) => s.type);

  const submit = async () => {
    if (!allAccepted(value, outstanding)) return;
    try {
      await accept.mutateAsync(
        outstanding.map((type) => ({ type, version: effectiveVersion(type, published).version })),
      );
      setValue(emptyConsentValue);
      toast.success("Agreement recorded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't record your agreement");
    }
  };

  return (
    <div className="min-h-dvh bg-background pb-24">
      <BackHeader title="Legal & Privacy" fallbackTo="/settings" />

      <main className="mx-auto max-w-xl space-y-4 px-4 py-4">
        <LegalReviewBanner />

        <section className="space-y-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Documents
          </h2>
          {LEGAL_DOCUMENT_LIST.map((doc) => {
            const v = effectiveVersion(doc.type, published);
            return (
              <Link
                key={doc.type}
                to={doc.path}
                className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 transition hover:bg-surface-2"
              >
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{doc.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    Version {v.version} · effective {v.effectiveDate}
                  </span>
                </span>
              </Link>
            );
          })}
        </section>

        {!user ? (
          <p className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted-foreground">
            <Link to="/auth" className="text-lime underline">
              Sign in
            </Link>{" "}
            to see your consent history.
          </p>
        ) : (
          <section className="space-y-2">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Your consent status
            </h2>
            {isLoading ? (
              <p className="px-1 text-sm text-muted-foreground">Loading…</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                {statuses.map((s) => (
                  <li key={s.type} className="flex items-start gap-3 px-4 py-3.5">
                    {s.needsAcceptance ? (
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-coral" aria-hidden />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-lime" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{s.title}</div>
                      <p className="text-xs text-muted-foreground">
                        {s.needsAcceptance
                          ? s.acceptedVersion
                            ? `You accepted version ${s.acceptedVersion}. Current version is ${s.currentVersion}.`
                            : `Not accepted yet. Current version is ${s.currentVersion}.`
                          : `Accepted version ${s.acceptedVersion} on ${new Date(
                              s.acceptedAt as string,
                            ).toLocaleString()}.`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {outstanding.length > 0 ? (
              <div className="space-y-3 rounded-2xl border border-border bg-surface p-3">
                <p className="text-sm font-medium">Accept the current version</p>
                <LegalConsent
                  value={value}
                  onChange={setValue}
                  types={outstanding}
                  disabled={accept.isPending}
                />
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!allAccepted(value, outstanding) || accept.isPending}
                  className="w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
                >
                  {accept.isPending ? "Saving…" : "Agree and record"}
                </button>
              </div>
            ) : null}

            {records.length > 0 ? (
              <div className="rounded-2xl border border-border bg-surface p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  History
                </p>
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  {records.map((r) => (
                    <li key={`${r.document_type}-${r.document_version}`}>
                      <span className="font-semibold text-foreground">
                        {r.document_type === "terms" ? "Terms of Service" : "Privacy Policy"}
                      </span>{" "}
                      v{r.document_version} — {new Date(r.accepted_at).toLocaleString()}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}
