/**
 * Data export + retention — the app's single source of truth for what a member
 * can download about themselves, and how long ballaCity keeps each kind of data.
 *
 * Nothing here is a legal compliance guarantee; retention periods still need
 * legal sign-off (see docs/data-retention.md, LEGAL REVIEW REQUIRED).
 */

export type ExportStatus = "requested" | "processing" | "ready" | "expired" | "failed";

export const EXPORT_STATUS_META: Record<
  ExportStatus,
  { label: string; description: string; tone: "neutral" | "progress" | "ready" | "error" }
> = {
  requested: {
    label: "Requested",
    description: "We have your request and will start building the file shortly.",
    tone: "neutral",
  },
  processing: {
    label: "Processing",
    description: "Collecting your data and packaging it into a JSON file.",
    tone: "progress",
  },
  ready: {
    label: "Ready",
    description: "Your download link is available until it expires.",
    tone: "ready",
  },
  expired: {
    label: "Expired",
    description: "The download window closed. Request a new export any time.",
    tone: "neutral",
  },
  failed: {
    label: "Failed",
    description: "Something went wrong building the file. You can try again.",
    tone: "error",
  },
};

/** How long a finished export stays downloadable. */
export const EXPORT_TTL_HOURS = 24;
/** Lifetime of each signed download URL handed to the browser. */
export const EXPORT_SIGNED_URL_SECONDS = 60 * 60;
/** Private bucket that holds generated export files. */
export const EXPORT_BUCKET = "data-exports";
/** Requests allowed per rolling 24 hours (mirrors the database trigger). */
export const EXPORT_DAILY_LIMIT = 3;

export type ExportCategory =
  | "profile"
  | "preferences"
  | "games_created"
  | "games_joined"
  | "availability"
  | "reviews"
  | "media_metadata"
  | "ai_analysis"
  | "safety"
  | "legal_consents"
  | "payments";

export const EXPORT_CATEGORIES: Array<{
  id: ExportCategory;
  label: string;
  description: string;
}> = [
  {
    id: "profile",
    label: "Profile information",
    description: "Name, username, bio, city, birthday, links and profile types you created.",
  },
  {
    id: "preferences",
    label: "Preferences",
    description: "Privacy, notification and feed preferences, including your AI choices.",
  },
  {
    id: "games_created",
    label: "Games created",
    description: "Games you hosted, with schedule, location and settings you entered.",
  },
  {
    id: "games_joined",
    label: "Games joined",
    description: "Your join records, join requests and position waitlist entries.",
  },
  {
    id: "availability",
    label: "Availability",
    description: "Your availability windows, sports and travel radius.",
  },
  {
    id: "reviews",
    label: "Reviews",
    description: "Reviews you wrote about players, teams, trainers and gyms.",
  },
  {
    id: "media_metadata",
    label: "Uploaded media metadata",
    description:
      "Details about your highlight clips and uploads — file paths, titles and dates, not the video files themselves.",
  },
  {
    id: "ai_analysis",
    label: "AI analysis metadata",
    description: "AI titles, captions, hashtags, detected moments and coaching notes on your clips.",
  },
  {
    id: "safety",
    label: "Safety records",
    description: "Accounts you blocked and reports you filed (your side only).",
  },
  {
    id: "legal_consents",
    label: "Legal acceptances",
    description: "Which policy versions you accepted and when.",
  },
  {
    id: "payments",
    label: "Payment records",
    description:
      "Your entry-fee submissions, subscription status and purchase receipts — never card or account credentials.",
  },
];

export const ALL_EXPORT_CATEGORIES: ExportCategory[] = EXPORT_CATEGORIES.map((c) => c.id);

/**
 * Data deliberately kept out of every export. Some of it protects other
 * members, some of it would be a security risk in a downloadable file.
 */
export const EXPORT_EXCLUSIONS: string[] = [
  "Passwords, password hashes and password-reset tokens",
  "Session tokens, API keys and other authentication secrets",
  "Other members' private information, including their contact details and messages they sent you",
  "Internal moderation notes, reviewer identities and admin audit entries",
  "System credentials, service keys and infrastructure configuration",
  "Payment credentials such as card numbers or bank details (ballaCity never stores them)",
];

export function exportCategoryLabel(id: string): string {
  return EXPORT_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

/** True when a ready export's download window has already lapsed. */
export function isExportExpired(
  row: { status: ExportStatus; expires_at: string | null },
  now: Date = new Date(),
): boolean {
  if (row.status === "expired") return true;
  if (!row.expires_at) return false;
  if (row.status === "failed") return false;
  return new Date(row.expires_at).getTime() <= now.getTime();
}

/** Status to show in the UI, folding lapsed windows into "expired". */
export function effectiveExportStatus(
  row: { status: ExportStatus; expires_at: string | null },
  now: Date = new Date(),
): ExportStatus {
  return isExportExpired(row, now) ? "expired" : row.status;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
