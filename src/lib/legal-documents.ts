/**
 * Single source of truth for OpenRun's legal documents.
 *
 * Nothing in the app should hard-code legal copy: routes, consent checkboxes,
 * and the settings screen all read from this registry. Publishing a new version
 * means bumping `version` here (and setting `material: true` when acceptance
 * must be collected again) — users are then flagged for re-acceptance instead
 * of being silently migrated.
 *
 * The body text below is PLACEHOLDER content and is labelled as such in the UI.
 */

export type LegalDocumentType = "terms" | "privacy";

export type LegalSection = { heading: string; body: string[] };

export type LegalDocumentVersion = {
  version: string;
  effectiveDate: string; // ISO date
  /** A material change requires every user to accept again. */
  material: boolean;
  summary: string;
  sections: LegalSection[];
};

export type LegalDocument = {
  type: LegalDocumentType;
  title: string;
  shortTitle: string;
  path: "/terms" | "/privacy";
  description: string;
  /** Newest version first. */
  versions: LegalDocumentVersion[];
};

/** Shown wherever placeholder legal copy is rendered. */
export const LEGAL_REVIEW_BANNER = "LEGAL REVIEW REQUIRED";
export const LEGAL_REVIEW_NOTE =
  "This document is placeholder content drafted for product development only. It has not been reviewed or approved by a lawyer and is not a statement of legal compliance.";

const TERMS: LegalDocument = {
  type: "terms",
  title: "Terms of Service",
  shortTitle: "Terms",
  path: "/terms",
  description: "The rules for using OpenRun to find, host, and join pickup games.",
  versions: [
    {
      version: "2026-09-01",
      effectiveDate: "2026-09-01",
      material: true,
      summary: "First published placeholder terms covering accounts, games, payments, and conduct.",
      sections: [
        {
          heading: "1. Your account",
          body: [
            "You need an OpenRun account to join or host games. Keep your sign-in details secure and provide accurate information about yourself.",
            "You must meet the minimum age set for any game you join, and hosts may require approval before you participate.",
          ],
        },
        {
          heading: "2. Games and participation",
          body: [
            "OpenRun connects players, teams, trainers, and gyms. We do not organize, supervise, coach, or insure any activity listed on the platform.",
            "You take part in physical activity at your own risk and are responsible for your own health, equipment, and safety decisions.",
          ],
        },
        {
          heading: "3. Payments between players and hosts",
          body: [
            "OpenRun does not process payments, hold funds, or act as an escrow or payment processor. Any entry fee is paid directly between you and the host.",
            "Verify recipient details before sending money. Refunds and disputes are handled between you and the host.",
          ],
        },
        {
          heading: "4. Content and conduct",
          body: [
            "You are responsible for the profiles, posts, highlight reels, and messages you publish, and you must have the rights to any media you upload.",
            "Harassment, discrimination, impersonation, illegal activity, and sexually explicit or violent content are not allowed. We may hide or remove content and suspend accounts that break these rules.",
          ],
        },
        {
          heading: "5. Changes and ending your account",
          body: [
            "We may update these terms. When a change is material we will ask you to accept the new version before continuing to use the app.",
            "You can delete your account at any time from Settings. Some records may be retained where we are required to keep them.",
          ],
        },
      ],
    },
  ],
};

const PRIVACY: LegalDocument = {
  type: "privacy",
  title: "Privacy Policy",
  shortTitle: "Privacy",
  path: "/privacy",
  description: "What personal data OpenRun collects, why, and the controls you have.",
  versions: [
    {
      version: "2026-09-01",
      effectiveDate: "2026-09-01",
      material: true,
      summary:
        "First published placeholder privacy policy covering profile data, location, media, and your controls.",
      sections: [
        {
          heading: "1. What we collect",
          body: [
            "Account details you give us: name, email, sign-in provider, profile photo, bio, sports, skill levels, availability, and links.",
            "Activity data: games you host or join, requests, messages, comments, reactions, reviews, and highlight reels you upload.",
            "Device and approximate location data used to show distances and nearby games, only while you allow location access.",
          ],
        },
        {
          heading: "2. Why we use it",
          body: [
            "To run the core product: matching players with games, showing distance, sending notifications you enabled, and keeping the platform safe.",
            "To troubleshoot problems and to detect abuse, spam, and policy violations.",
          ],
        },
        {
          heading: "3. Sharing",
          body: [
            "Parts of your profile are public by design (name, initials, sports, and public reels). Your photo visibility follows the setting you pick in Settings.",
            "We use service providers for hosting, storage, media processing, and notifications. We do not sell your personal data.",
          ],
        },
        {
          heading: "4. Your controls",
          body: [
            "You can edit or hide profile details, control photo visibility, manage notification preferences, hide or delete highlight reels, block users, and delete your account.",
            "Your legal consent history is visible to you under Settings → Legal & Privacy.",
          ],
        },
        {
          heading: "5. Retention and contact",
          body: [
            "We keep data while your account is active and for as long as needed to meet legal or safety obligations.",
            "For privacy questions, contact the OpenRun team through the app.",
          ],
        },
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS: Record<LegalDocumentType, LegalDocument> = {
  terms: TERMS,
  privacy: PRIVACY,
};

export const LEGAL_DOCUMENT_LIST: LegalDocument[] = [TERMS, PRIVACY];

export const LEGAL_DOCUMENT_TYPES: LegalDocumentType[] = ["terms", "privacy"];

export function getLegalDocument(type: LegalDocumentType): LegalDocument {
  return LEGAL_DOCUMENTS[type];
}

export function currentVersion(type: LegalDocumentType): LegalDocumentVersion {
  return LEGAL_DOCUMENTS[type].versions[0];
}

export function findVersion(type: LegalDocumentType, version: string) {
  return LEGAL_DOCUMENTS[type].versions.find((v) => v.version === version) ?? null;
}

export type ConsentRecord = {
  document_type: LegalDocumentType;
  document_version: string;
  accepted_at: string;
};

export type ConsentStatus = {
  type: LegalDocumentType;
  title: string;
  path: "/terms" | "/privacy";
  currentVersion: string;
  effectiveDate: string;
  acceptedVersion: string | null;
  acceptedAt: string | null;
  /** True when the user has never accepted, or accepted an older version. */
  needsAcceptance: boolean;
};

/**
 * A published row from the `legal_documents` table. When present it takes
 * precedence over the bundled registry above, which is only a fallback for the
 * (unlikely) case that nothing is published yet.
 */
export type PublishedLegalDocument = {
  id: string;
  document_type: string;
  title: string;
  version: string;
  content: string;
  summary: string;
  requires_reacceptance: boolean;
  effective_date: string;
  published: boolean;
  published_at: string | null;
  archived_at: string | null;
};

/** The version users are currently shown for a consent document. */
export function effectiveVersion(
  type: LegalDocumentType,
  published?: PublishedLegalDocument[] | null,
): LegalDocumentVersion & { content?: string } {
  const row = published?.find((p) => p.document_type === type && p.published);
  if (!row) return currentVersion(type);
  return {
    version: row.version,
    effectiveDate: row.effective_date,
    material: row.requires_reacceptance,
    summary: row.summary,
    sections: parseLegalContent(row.content),
    content: row.content,
  };
}

/** Splits stored markdown-lite content ("## Heading" + paragraphs) into sections. */
export function parseLegalContent(content: string): LegalSection[] {
  const sections: LegalSection[] = [];
  let current: LegalSection | null = null;
  for (const rawBlock of content.split(/\n{2,}/)) {
    const block = rawBlock.trim();
    if (!block) continue;
    const lines = block.split("\n");
    const first = lines[0].trim();
    if (first.startsWith("#")) {
      current = { heading: first.replace(/^#+\s*/, ""), body: [] };
      sections.push(current);
      const rest = lines.slice(1).join(" ").trim();
      if (rest) current.body.push(rest);
      continue;
    }
    if (!current) {
      current = { heading: "", body: [] };
      sections.push(current);
    }
    current.body.push(lines.join(" ").trim());
  }
  return sections;
}

/** Turns sections back into stored content (used to seed a draft from the registry). */
export function sectionsToContent(sections: LegalSection[]): string {
  return sections.map((s) => `## ${s.heading}\n${s.body.join("\n\n")}`).join("\n\n");
}

/**
 * Compares what the user accepted against the current published versions.
 * A newer version always shows as "update available"; acceptance is only
 * required (blocking) when that version is flagged material.
 */
export function buildConsentStatus(
  records: ConsentRecord[],
  published?: PublishedLegalDocument[] | null,
): ConsentStatus[] {
  return LEGAL_DOCUMENT_LIST.map((doc) => {
    const current = effectiveVersion(doc.type, published);
    const mine = records
      .filter((r) => r.document_type === doc.type)
      .sort((a, b) => (a.accepted_at < b.accepted_at ? 1 : -1));
    const accepted = mine.find((r) => r.document_version === current.version) ?? null;
    const latest = mine[0] ?? null;
    return {
      type: doc.type,
      title: doc.title,
      path: doc.path,
      currentVersion: current.version,
      effectiveDate: current.effectiveDate,
      acceptedVersion: latest?.document_version ?? null,
      acceptedAt: latest?.accepted_at ?? null,
      needsAcceptance: !accepted,
    };
  });
}

/** Document types the user must accept before continuing (material versions only). */
export function pendingRequiredTypes(
  records: ConsentRecord[],
  published?: PublishedLegalDocument[] | null,
): LegalDocumentType[] {
  return buildConsentStatus(records, published)
    .filter((s) => s.needsAcceptance && effectiveVersion(s.type, published).material)
    .map((s) => s.type);
}

