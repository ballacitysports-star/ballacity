/**
 * Single source of truth for BallaCity's legal documents.
 *
 * Nothing in the app should hard-code legal copy: routes, consent checkboxes,
 * and the settings screen all read from this registry. Publishing a new version
 * means bumping `version` here (and setting `material: true` when acceptance
 * must be collected again) — users are then flagged for re-acceptance instead
 * of being silently migrated.
 *
 * The body text below is PLACEHOLDER content and is labelled as such in the UI.
 */

export type LegalDocumentType =
  "terms" | "privacy" | "cookie_preferences" | "payment_policy" | "ai_disclosure" | "youth_policy";

/**
 * The subset users must actively accept. Everything else is informational, so
 * keeping it out of this union stops it leaking into consent records and
 * signup gates.
 */
export type ConsentDocumentType = "terms" | "privacy";

/**
 * A section is a heading plus alternating prose and bullet blocks, kept in
 * source order so a list stays attached to the paragraph that introduces it.
 */
export type LegalBlock = { kind: "p"; text: string } | { kind: "ul"; items: string[] };

export type LegalSection = {
  heading: string;
  /** Prose paragraphs only — kept for existing callers and round-tripping. */
  body: string[];
  /** Full ordered content, including bullet lists. Preferred for rendering. */
  blocks?: LegalBlock[];
};

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
  path: "/terms" | "/privacy" | "/cookies" | "/payment-policy" | "/ai-disclosure" | "/youth-policy";
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
  description: "The rules for using BallaCity to find, host, and join pickup games.",
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
            "You need a BallaCity account to join or host games. Keep your sign-in details secure and provide accurate information about yourself.",
            "You must meet the minimum age set for any game you join, and hosts may require approval before you participate.",
          ],
        },
        {
          heading: "2. Games and participation",
          body: [
            "BallaCity connects players, teams, trainers, and gyms. We do not organize, supervise, coach, or insure any activity listed on the platform.",
            "You take part in physical activity at your own risk and are responsible for your own health, equipment, and safety decisions.",
          ],
        },
        {
          heading: "3. Payments between players and hosts",
          body: [
            "BallaCity does not process payments, hold funds, or act as an escrow or payment processor. Any entry fee is paid directly between you and the host.",
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
  description: "What personal data BallaCity collects, why, and the controls you have.",
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
            "For privacy questions, contact the BallaCity team through the app.",
          ],
        },
      ],
    },
  ],
};

const COOKIES: LegalDocument = {
  type: "cookie_preferences",
  title: "Cookies & Local Storage",
  shortTitle: "Cookies",
  path: "/cookies",
  description: "What BallaCity stores in your browser, why, and how to clear it.",
  versions: [
    {
      version: "2026-09-01",
      effectiveDate: "2026-09-01",
      material: false,
      summary: "Placeholder notice about browser storage used for sign-in and preferences.",
      sections: [
        {
          heading: "1. What we store",
          body: [
            "BallaCity keeps you signed in and remembers your preferences using storage in your own browser rather than advertising cookies.",
          ],
        },
        {
          heading: "2. Managing it",
          body: [
            "Clearing site data for BallaCity in your browser removes everything described here and signs you out.",
          ],
        },
      ],
    },
  ],
};

const PAYMENT_POLICY: LegalDocument = {
  type: "payment_policy",
  title: "Payment Policy",
  shortTitle: "Payments",
  path: "/payment-policy",
  description: "How game fees are paid directly between players and hosts.",
  versions: [
    {
      version: "2026-10-14",
      effectiveDate: "2026-10-14",
      material: false,
      summary: "Placeholder policy describing direct player-to-host payments.",
      sections: [
        {
          heading: "1. BallaCity is not a payment processor",
          body: [
            "Game fees are paid directly from player to host using the host's own payment service (for example Venmo, Zelle, or cash). Money never moves through BallaCity.",
            "BallaCity does not hold funds, act as an escrow, or guarantee any payment.",
          ],
        },
        {
          heading: "2. Marking a payment",
          body: [
            "You can mark a payment as sent so the host can confirm, reject, or dispute it. This is a record of what you told the host, not proof that money moved.",
            "Check the host's payment details before sending money.",
          ],
        },
        {
          heading: "3. Refunds and disputes",
          body: [
            "Because payments are direct, BallaCity cannot reverse a transfer or issue a refund. Ask the host first, then contact your payment service.",
            "Report hosts who take payment and do not run the game so moderators can act on the account.",
          ],
        },
        {
          heading: "4. BallaCity plans",
          body: [
            "Subscriptions for BallaCity plans are separate from game fees and are handled by our billing provider.",
          ],
        },
      ],
    },
  ],
};

const AI_DISCLOSURE: LegalDocument = {
  type: "ai_disclosure",
  title: "AI & Video Disclosure",
  shortTitle: "AI disclosure",
  path: "/ai-disclosure",
  description: "How AI features analyze your clips, their limits, and how to opt out.",
  versions: [
    {
      version: "2026-10-14",
      effectiveDate: "2026-10-14",
      material: false,
      summary: "Placeholder disclosure covering AI clip analysis and its limitations.",
      sections: [
        {
          heading: "1. What AI does",
          body: [
            "AI features analyze highlight clips you upload to suggest titles, captions, on-screen text, and hashtags, and to help edit reels.",
            "Suggestions are drafts. You review and edit everything before it is published.",
          ],
        },
        {
          heading: "2. What AI does not do",
          body: [
            "AI does not judge players, decide skill levels, or moderate accounts. It is not a scouting or officiating tool.",
            "AI output can be inaccurate or miss context.",
          ],
        },
        {
          heading: "3. Movement analysis stays on your device",
          body: [
            "Where a feature tracks body movement in a clip, that tracking runs in your browser. Only a summary of the results is saved; the raw body landmarks never leave your device.",
            "Movement tracking is not run on family clips.",
          ],
        },
        {
          heading: "4. Younger players and your controls",
          body: [
            "AI analysis of a child's clips requires a parent or guardian's permission.",
            "You can turn AI processing of your uploads off in Settings → AI & Video Privacy.",
          ],
        },
      ],
    },
  ],
};

const YOUTH_POLICY: LegalDocument = {
  type: "youth_policy",
  title: "Youth & Minor Policy",
  shortTitle: "Youth policy",
  path: "/youth-policy",
  description: "Minimum age, parental consent, and the extra protections for younger players.",
  versions: [
    {
      version: "2026-10-14",
      effectiveDate: "2026-10-14",
      material: false,
      summary: "Placeholder policy covering age requirements and protections for minors.",
      sections: [
        {
          heading: "1. Age and parental consent",
          body: [
            "Everyone gives their date of birth when they sign up. It is never shown publicly; only an age group is used to run age-appropriate features.",
            "Younger players need a parent or guardian's consent before social features are turned on. Until consent is approved, the account is limited to browsing.",
            "Parents and guardians can review a child's account and revoke consent at any time.",
          ],
        },
        {
          heading: "2. Protections for minors",
          body: [
            "Children cannot be found through social discovery, and their media is not public.",
            "Direct messages between adults and minors are restricted, and a child's precise location is never made public.",
            "AI analysis of a child's clips requires a parent or guardian's permission.",
          ],
        },
        {
          heading: "3. Teams and events",
          body: [
            "Team managers may require a signed waiver before a player joins. For a child, a parent or guardian signs on their behalf.",
            "Hosts and coaches are responsible for supervising their own events. BallaCity does not supervise games.",
          ],
        },
        {
          heading: "4. Reporting concerns",
          body: [
            "Report anything that puts a young player at risk using the flag icon or the Child Safety page.",
          ],
        },
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS: Record<LegalDocumentType, LegalDocument> = {
  terms: TERMS,
  privacy: PRIVACY,
  cookie_preferences: COOKIES,
  payment_policy: PAYMENT_POLICY,
  ai_disclosure: AI_DISCLOSURE,
  youth_policy: YOUTH_POLICY,
};

/**
 * Documents that require explicit acceptance. The informational documents
 * (cookies, payments, AI, youth) are deliberately absent: adding one here
 * would gate signup and re-acceptance on a document nobody needs to agree to.
 */
export const LEGAL_DOCUMENT_LIST: LegalDocument[] = [TERMS, PRIVACY];

export const LEGAL_DOCUMENT_TYPES: ConsentDocumentType[] = ["terms", "privacy"];

/** Every document with a public page, consent-gated or not. */
export const LEGAL_PAGE_LIST: LegalDocument[] = [
  TERMS,
  PRIVACY,
  COOKIES,
  PAYMENT_POLICY,
  AI_DISCLOSURE,
  YOUTH_POLICY,
];

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
  document_type: ConsentDocumentType;
  document_version: string;
  accepted_at: string;
};

export type ConsentStatus = {
  type: ConsentDocumentType;
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

/**
 * The live published version of any managed document, or null when nothing is
 * published. For pages whose bundled copy is not part of this registry (such
 * as the Community Guidelines and Safety Center), so they can keep their own
 * fallback instead of `effectiveVersion`'s.
 */
export function livePublishedVersion(
  type: string,
  published?: PublishedLegalDocument[] | null,
): LegalDocumentVersion | null {
  const row = published?.find((p) => p.document_type === type && p.published);
  if (!row) return null;
  return {
    version: row.version,
    effectiveDate: row.effective_date,
    material: row.requires_reacceptance,
    summary: row.summary,
    sections: parseLegalContent(row.content),
  };
}

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

/**
 * Splits stored markdown-lite content into sections.
 *
 * Supports "## Heading", paragraphs, and "- item" bullet lists — the last
 * because a privacy policy is mostly enumerations (data categories, who we
 * share with, your rights) and those read terribly as run-on prose.
 * Deliberately no bold, links or tables.
 */
export function parseLegalContent(content: string): LegalSection[] {
  const sections: LegalSection[] = [];
  let current: LegalSection | null = null;

  const open = (heading: string) => {
    current = { heading, body: [], blocks: [] };
    sections.push(current);
    return current;
  };
  const addText = (text: string) => {
    const sec = current ?? open("");
    sec.body.push(text);
    sec.blocks!.push({ kind: "p", text });
  };
  const addList = (items: string[]) => {
    const sec = current ?? open("");
    sec.blocks!.push({ kind: "ul", items });
  };

  const isBullet = (l: string) => /^[-*]\s+/.test(l.trim());
  const strip = (l: string) => l.trim().replace(/^[-*]\s+/, "");

  /** Emit a run of lines as a paragraph, a list, or a lead-in plus a list. */
  const emit = (lines: string[]) => {
    if (!lines.length) return;
    const firstBullet = lines.findIndex(isBullet);
    if (firstBullet === -1) {
      const text = lines.join(" ").trim();
      if (text) addText(text);
      return;
    }
    const lead = lines.slice(0, firstBullet).join(" ").trim();
    if (lead) addText(lead);
    addList(lines.slice(firstBullet).filter(isBullet).map(strip));
  };

  for (const rawBlock of content.split(/\n{2,}/)) {
    const block = rawBlock.trim();
    if (!block) continue;
    const lines = block.split("\n");
    const first = lines[0].trim();

    if (first.startsWith("#")) {
      open(first.replace(/^#+\s*/, ""));
      emit(lines.slice(1));
      continue;
    }
    emit(lines);
  }

  // Only carry `blocks` on sections that actually contain a list. Prose-only
  // sections keep their original { heading, body } shape, so every existing
  // caller and the bundled registry are untouched by list support.
  for (const sec of sections) {
    if (!sec.blocks?.some((b) => b.kind === "ul")) delete sec.blocks;
  }
  return sections;
}

/** Turns sections back into stored content (used to seed a draft from the registry). */
export function sectionsToContent(sections: LegalSection[]): string {
  return sections
    .map((s) => {
      // Prefer blocks so bullet lists survive the round trip; fall back to
      // body for sections built by hand in the bundled registry.
      const parts = s.blocks?.length
        ? s.blocks.map((b) => (b.kind === "ul" ? b.items.map((i) => `- ${i}`).join("\n") : b.text))
        : s.body;
      return `## ${s.heading}\n${parts.join("\n\n")}`;
    })
    .join("\n\n");
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
      // LEGAL_DOCUMENT_LIST holds only the two consent documents, so these
      // narrow safely — cookies never reaches here.
      type: doc.type as ConsentDocumentType,
      title: doc.title,
      path: doc.path as ConsentStatus["path"],
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
): ConsentDocumentType[] {
  return buildConsentStatus(records, published)
    .filter((s) => s.needsAcceptance && effectiveVersion(s.type, published).material)
    .map((s) => s.type);
}
