/**
 * Canonical catalog of audited administrative actions.
 *
 * Client-safe: labels and groupings are shared by the admin Audit Logs UI and
 * the server-side logger so an action never shows up as a raw string.
 */

export const AUDIT_CATEGORIES = [
  "users",
  "content",
  "reports",
  "legal",
  "settings",
  "permissions",
  "payments",
  "security",
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  users: "Accounts",
  content: "Content",
  reports: "Reports",
  legal: "Legal documents",
  settings: "Feature flags & settings",
  permissions: "Permissions",
  payments: "Payments",
  security: "Security",
};

type AuditActionMeta = { label: string; category: AuditCategory };

/**
 * Every action the app writes. Keys are the stored `action` values — treat them
 * as an append-only vocabulary: history keeps old keys forever.
 */
export const AUDIT_ACTIONS = {
  // Accounts
  "user.suspend": { label: "User suspended", category: "users" },
  "user.ban": { label: "User banned", category: "users" },
  "user.restore": { label: "User restored", category: "users" },
  "user.warn": { label: "User warned", category: "users" },
  "user.profile_update": { label: "Profile edited by admin", category: "users" },
  "user.force_signout": { label: "Sessions revoked", category: "users" },
  "user.unsuspend": { label: "Suspension lifted", category: "users" },
  "user.delete": { label: "Account deleted by admin", category: "users" },
  "account.recovery": { label: "Account recovery action", category: "users" },
  "account.email_change": { label: "Account email changed", category: "users" },
  "account.password_reset_sent": { label: "Password reset sent", category: "users" },

  // Content
  "content.remove": { label: "Content removed", category: "content" },
  "content.restore": { label: "Content restored", category: "content" },
  "content.hide": { label: "Content hidden", category: "content" },
  "image.block": { label: "Image blocked", category: "content" },
  "image.approve": { label: "Image approved", category: "content" },
  "reel.remove": { label: "Reel removed", category: "content" },
  "review.moderate": { label: "Review moderated", category: "content" },
  "listing.create_unclaimed": { label: "Unclaimed listing created", category: "content" },
  "listing.edit_unclaimed": { label: "Unclaimed listing edited", category: "content" },
  "listing.delete_unclaimed": { label: "Unclaimed listing deleted", category: "content" },
  "listing.claim_approve": { label: "Listing claim approved", category: "content" },
  "listing.claim_deny": { label: "Listing claim denied", category: "content" },
  "listing.feature": { label: "Facility featured", category: "content" },
  "listing.unfeature": { label: "Facility unfeatured", category: "content" },
  "listings.games.edit": { label: "Game edited by admin", category: "content" },
  "listings.tryouts.edit": { label: "Tryout or camp edited by admin", category: "content" },
  "listings.availability.edit": { label: "Availability post edited by admin", category: "content" },
  "discovery.run": { label: "Listing discovery run started", category: "content" },
  "discovery.approve": { label: "Discovered listing approved", category: "content" },
  "discovery.reject": { label: "Discovered listing rejected", category: "content" },

  // Reports
  "report.resolve": { label: "Report resolved", category: "reports" },
  "report.dismiss": { label: "Report dismissed", category: "reports" },
  "report.status": { label: "Report status changed", category: "reports" },
  "report.action": { label: "Action taken on report", category: "reports" },

  // Legal documents
  "legal.draft_create": { label: "Legal draft created", category: "legal" },
  "legal.draft_update": { label: "Legal draft edited", category: "legal" },
  "legal.draft_delete": { label: "Legal draft deleted", category: "legal" },
  "legal.publish": { label: "Legal document published", category: "legal" },
  "legal.unpublish": { label: "Legal document unpublished", category: "legal" },
  "compliance.review": { label: "Compliance controls reviewed", category: "legal" },

  // Feature flags & settings
  "setting.update": { label: "Setting changed", category: "settings" },
  "feature_flag.update": { label: "Feature flag changed", category: "settings" },
  "ops.broadcast": { label: "Broadcast sent", category: "settings" },

  // Permissions
  "role.grant": { label: "Role granted", category: "permissions" },
  "role.revoke": { label: "Role revoked", category: "permissions" },

  // Payments
  "payment.set_status": { label: "Payment status changed", category: "payments" },
  "payment_method.enable": { label: "Payment method enabled", category: "payments" },
  "payment_method.disable": { label: "Payment method disabled", category: "payments" },
  "payment.refund_note": { label: "Payment note recorded", category: "payments" },

  // Security
  "security.setting_update": { label: "Security setting changed", category: "security" },
  "security.audit_export": { label: "Audit log exported", category: "security" },

  // AI
  "ai.setting_update": { label: "AI setting changed", category: "settings" },
  "ai.content_quarantine": { label: "AI content quarantined", category: "content" },

  // Legacy keys kept so historical entries still render a friendly label.
  moderation_warn: { label: "User warned", category: "users" },
  moderation_suspend: { label: "User suspended", category: "users" },
  moderation_ban: { label: "User banned", category: "users" },
  moderation_restore: { label: "User restored", category: "users" },
  moderation_remove_content: { label: "Content removed", category: "content" },
  report_status_resolved: { label: "Report resolved", category: "reports" },
  report_status_dismissed: { label: "Report dismissed", category: "reports" },
  report_status_investigating: { label: "Report status changed", category: "reports" },
  report_status_new: { label: "Report status changed", category: "reports" },
  legal_document_published: { label: "Legal document published", category: "legal" },
  legal_document_unpublished: { label: "Legal document unpublished", category: "legal" },
  legal_document_created: { label: "Legal draft created", category: "legal" },
  legal_document_updated: { label: "Legal draft edited", category: "legal" },
  "games.cancel_game": { label: "Game cancelled by admin", category: "content" },
  "games.delete_game": { label: "Game deleted by admin", category: "content" },
} as const satisfies Record<string, AuditActionMeta>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export function auditActionLabel(action: string): string {
  return (AUDIT_ACTIONS as Record<string, AuditActionMeta>)[action]?.label ?? action;
}

export function auditActionCategory(action: string): AuditCategory | null {
  return (AUDIT_ACTIONS as Record<string, AuditActionMeta>)[action]?.category ?? null;
}

export function auditActionsInCategory(category: AuditCategory): string[] {
  return Object.entries(AUDIT_ACTIONS)
    .filter(([, meta]) => meta.category === category)
    .map(([key]) => key);
}

const TARGET_LABELS: Record<string, string> = {
  user: "Account",
  profile: "Profile",
  game: "Game",
  message: "Message",
  reel: "Highlight reel",
  review: "Review",
  team: "Team / trainer",
  org: "Gym",
  legal_document: "Legal document",
  app_setting: "Setting",
  payment_submission: "Payment",
  host_payment_method: "Payment method",
  storage_object: "Image",
  report: "Report",
  audit_log: "Audit log",
  games: "Game",
  user_report: "Report",
  notification: "Broadcast",
};

export function auditTargetLabel(targetType: string): string {
  return TARGET_LABELS[targetType] ?? targetType;
}
