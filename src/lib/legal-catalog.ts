/**
 * Catalog of every legal/policy document that can be managed from
 * Admin → Legal & Compliance. Copy itself lives in the database
 * (`legal_documents`); this file only describes the slots.
 */

export const MANAGED_LEGAL_TYPES = [
  "terms",
  "privacy",
  "community_guidelines",
  "safety_guidelines",
  "payment_policy",
  "ai_disclosure",
  "youth_policy",
  "cookie_preferences",
] as const;

export type ManagedLegalType = (typeof MANAGED_LEGAL_TYPES)[number];

export type ManagedLegalMeta = {
  type: ManagedLegalType;
  label: string;
  /** Public route that renders this document, when one exists. */
  path: string | null;
  /** Consent documents are the ones users are asked to accept. */
  requiresConsent: boolean;
  description: string;
};

export const MANAGED_LEGAL_META: Record<ManagedLegalType, ManagedLegalMeta> = {
  terms: {
    type: "terms",
    label: "Terms of Service",
    path: "/terms",
    requiresConsent: true,
    description: "Rules for using ballaCity to find, host, and join games.",
  },
  privacy: {
    type: "privacy",
    label: "Privacy Policy",
    path: "/privacy",
    requiresConsent: true,
    description: "What personal data ballaCity collects and the controls users have.",
  },
  community_guidelines: {
    type: "community_guidelines",
    label: "Community Guidelines",
    path: "/community-guidelines",
    requiresConsent: false,
    description: "Expected behaviour and how violations are handled.",
  },
  safety_guidelines: {
    type: "safety_guidelines",
    label: "Safety Guidelines",
    path: "/safety",
    requiresConsent: false,
    description: "Guidance for meeting players, game safety, and reporting.",
  },
  payment_policy: {
    type: "payment_policy",
    label: "Payment Policy",
    path: null,
    requiresConsent: false,
    description: "How direct player-to-host payments work on ballaCity.",
  },
  ai_disclosure: {
    type: "ai_disclosure",
    label: "AI / Video Disclosure",
    path: null,
    requiresConsent: false,
    description: "How AI video analysis works and its limitations.",
  },
  youth_policy: {
    type: "youth_policy",
    label: "Youth / Minor Policy",
    path: null,
    requiresConsent: false,
    description: "Minimum age, teen protections, and messaging limits.",
  },
  cookie_preferences: {
    type: "cookie_preferences",
    label: "Cookie & Privacy Preferences",
    path: "/cookies",
    requiresConsent: false,
    description: "Storage used for sign-in and preferences, and how to manage it.",
  },
};

export const MANAGED_LEGAL_LIST: ManagedLegalMeta[] = MANAGED_LEGAL_TYPES.map(
  (t) => MANAGED_LEGAL_META[t],
);

export function isManagedLegalType(v: string): v is ManagedLegalType {
  return (MANAGED_LEGAL_TYPES as readonly string[]).includes(v);
}

export function legalTypeLabel(v: string): string {
  return isManagedLegalType(v) ? MANAGED_LEGAL_META[v].label : v;
}
