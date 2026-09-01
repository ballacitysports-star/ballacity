import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import {
  buildConsentStatus,
  effectiveVersion,
  pendingRequiredTypes,
  type ConsentRecord,
  type LegalDocumentType,
  type PublishedLegalDocument,
} from "@/lib/legal-documents";
import { getMyLegalConsents, recordLegalConsent } from "@/lib/legal-consent.functions";
import { getPublishedLegalDocuments } from "@/lib/legal-documents.functions";

/**
 * Published document versions come from the admin-managed `legal_documents`
 * table; the bundled registry is only a fallback when nothing is published.
 */
export function usePublishedLegalDocuments() {
  const fetchDocs = useServerFn(getPublishedLegalDocuments);
  const query = useQuery({
    queryKey: ["legal-documents", "published"],
    queryFn: () => fetchDocs() as Promise<PublishedLegalDocument[]>,
    staleTime: 5 * 60_000,
  });
  return { ...query, published: query.data ?? null };
}

/** The version of a consent document users are currently shown. */
export function useEffectiveLegalVersion(type: LegalDocumentType) {
  const { published } = usePublishedLegalDocuments();
  return effectiveVersion(type, published);
}

const PENDING_KEY = "openrun:pending-legal-consent";

/**
 * Signup can complete without a session (email confirmation), so the exact
 * versions the user ticked are parked locally and written as soon as we have
 * an authenticated session. Nothing is ever accepted on the user's behalf —
 * this only replays a tick the user actually made.
 */
export function stashPendingConsent(acceptances: { type: LegalDocumentType; version: string }[]) {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(acceptances));
  } catch {
    /* storage unavailable */
  }
}

export function readPendingConsent(): { type: LegalDocumentType; version: string }[] {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a) => a && (a.type === "terms" || a.type === "privacy") && typeof a.version === "string",
    );
  } catch {
    return [];
  }
}

export function clearPendingConsent() {
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Acceptances for every currently published document version. */
export function currentAcceptances(published?: PublishedLegalDocument[] | null) {
  return (["terms", "privacy"] as LegalDocumentType[]).map((type) => ({
    type,
    version: effectiveVersion(type, published).version,
  }));
}

export function useMyLegalConsents() {
  const { user } = useAuth();
  const { published, isLoading: docsLoading } = usePublishedLegalDocuments();
  const fetchConsents = useServerFn(getMyLegalConsents);
  const query = useQuery({
    queryKey: ["legal-consents", user?.id ?? "anon"],
    queryFn: () => fetchConsents() as Promise<ConsentRecord[]>,
    enabled: !!user,
    staleTime: 60_000,
  });
  const records = query.data ?? [];
  return {
    ...query,
    isLoading: query.isLoading || docsLoading,
    published,
    records,
    statuses: buildConsentStatus(records, published),
    pendingRequired: query.data && !docsLoading ? pendingRequiredTypes(records, published) : [],
  };
}

export function useAcceptLegal() {
  const qc = useQueryClient();
  const record = useServerFn(recordLegalConsent);
  return useMutation({
    mutationFn: (acceptances: { type: LegalDocumentType; version: string }[]) =>
      record({ data: { acceptances } }),
    onSuccess: () => {
      clearPendingConsent();
      qc.invalidateQueries({ queryKey: ["legal-consents"] });
    },
  });
}
