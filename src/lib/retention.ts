/**
 * Documented retention configuration.
 *
 * This file describes what BallaCity keeps, for how long, and why. It is
 * intentionally descriptive rather than an automated purge job: several
 * categories have dependencies (safety cases, payment disputes, audit trails)
 * where deleting rows would break other people's records. Nothing is deleted
 * automatically from this configuration — `account.functions.ts` owns deletion
 * on user request, and anything listed as retained beyond that is called out
 * here so the product never promises deletion it cannot perform.
 *
 * LEGAL REVIEW REQUIRED: the durations below are engineering defaults.
 */

export type RetentionCategory =
  "account" | "messages" | "reports" | "media" | "ai_analysis" | "logs" | "payments";

export type RetentionRule = {
  category: RetentionCategory;
  label: string;
  /** Human-readable retention window. */
  retention: string;
  /** What is stored in this category. */
  contains: string;
  /** What happens when the member deletes their account. */
  onAccountDeletion: string;
  /** Why anything survives deletion, when it does. */
  reason: string;
  /** Whether BallaCity keeps anything after account deletion. */
  survivesDeletion: boolean;
  /** Tables/buckets this rule covers, for engineering traceability. */
  sources: string[];
};

export const RETENTION_RULES: RetentionRule[] = [
  {
    category: "account",
    label: "Account data",
    retention: "Kept while the account is active.",
    contains: "Profile details, profile types, availability, preferences and follow relationships.",
    onAccountDeletion:
      "Profile fields are scrubbed immediately, then the account and its own rows are deleted.",
    reason: "No reason to retain identifiable account data after deletion.",
    survivesDeletion: false,
    sources: [
      "profiles",
      "account_profiles",
      "player_availabilities",
      "privacy_preferences",
      "notification_preferences",
      "feed_preferences",
      "follows",
      "follow_requests",
    ],
  },
  {
    category: "messages",
    label: "Messages",
    retention: "Kept while the conversation exists (no automatic expiry today).",
    contains: "Direct messages, attachments metadata and reactions.",
    onAccountDeletion:
      "Message bodies and attachment references you sent are cleared and the messages marked deleted, so nothing personal remains in the other person's thread.",
    reason:
      "Empty message rows stay so the other participant's conversation history does not break.",
    survivesDeletion: true,
    sources: ["messages", "message_reactions", "conversations", "conversation_participants"],
  },
  {
    category: "reports",
    label: "Reports & safety records",
    retention: "Kept indefinitely today; a defined window needs legal review.",
    contains:
      "Reports filed about or by an account, blocks, moderation state and safety acknowledgments.",
    onAccountDeletion:
      "Reports filed about the account are retained without any profile details attached.",
    reason:
      "Safety cases must outlive the reported account, otherwise deleting and re-registering erases the history.",
    survivesDeletion: true,
    sources: ["user_reports", "user_blocks", "game_safety_acknowledgments"],
  },
  {
    category: "media",
    label: "Uploaded media",
    retention: "Kept while the account is active.",
    contains:
      "Avatars, covers, game covers, highlight videos, message attachments and payment proof images.",
    onAccountDeletion:
      "Files under the member's storage prefix are removed from every media bucket.",
    reason:
      "Payment proof images referenced by an open dispute may be retained until the dispute closes.",
    survivesDeletion: false,
    sources: [
      "avatars",
      "covers",
      "game-covers",
      "highlight-videos",
      "message-attachments",
      "payment-proofs",
      "team-avatars",
      "team-covers",
      "org-avatars",
      "org-covers",
      "trainer-avatars",
    ],
  },
  {
    category: "ai_analysis",
    label: "AI analysis",
    retention: "Kept with the clip it describes; deletable at any time from AI & Video Privacy.",
    contains:
      "AI titles, captions, hashtags, detected moments, transcripts, sampled frames and coaching notes.",
    onAccountDeletion: "Deleted with the member's highlight reels and derived files.",
    reason: "No reason to retain AI output after the clip is gone.",
    survivesDeletion: false,
    sources: ["highlight_reels", "highlight-videos"],
  },
  {
    category: "logs",
    label: "Logs & audit trails",
    retention:
      "Sign-in and delivery diagnostics: kept up to 90 days. Admin audit log: kept indefinitely (append-only).",
    contains:
      "Sign-in events, notification delivery attempts, location permission denials and administrative actions.",
    onAccountDeletion:
      "Diagnostic rows lose their link to the account. Admin audit entries are never modified.",
    reason:
      "The admin audit log is append-only by design so administrative actions stay accountable.",
    survivesDeletion: true,
    sources: [
      "auth_signin_events",
      "notification_delivery_log",
      "location_denial_events",
      "admin_audit_log",
    ],
  },
  {
    category: "payments",
    label: "Payment-related information",
    retention:
      "Kept for financial record-keeping; typically 7 years for receipts (needs legal review).",
    contains:
      "Entry-fee submissions and their verification history, subscription status and purchase receipts. BallaCity never stores card or bank credentials.",
    onAccountDeletion:
      "The member's saved payout handles are deleted. Submissions, receipts and verification events are retained.",
    reason: "Hosts, disputes and accounting need the record of what was paid for which game.",
    survivesDeletion: true,
    sources: [
      "payment_submissions",
      "payment_verification_events",
      "subscriptions",
      "purchases",
      "host_payment_methods",
    ],
  },
];

export function retentionRule(category: RetentionCategory): RetentionRule {
  const rule = RETENTION_RULES.find((r) => r.category === category);
  if (!rule) throw new Error(`Unknown retention category: ${category}`);
  return rule;
}

/** Categories where something legitimately survives account deletion. */
export const RETAINED_AFTER_DELETION = RETENTION_RULES.filter((r) => r.survivesDeletion);
