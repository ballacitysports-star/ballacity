/**
 * Plain-language labels for the append-only family activity trail.
 *
 * Rows are written by database triggers, so the action keys are stable and the
 * UI never has to trust client-side bookkeeping. Unknown keys still render
 * something readable rather than disappearing from the trail.
 */

const CONTROL_LABELS: Record<string, string> = {
  messaging: "Messaging",
  media_visibility: "Video visibility",
  location_precision: "Location precision",
  social_discovery: "Discoverable by other members",
  ai_analysis: "AI video analysis",
  game_participation: "Can join games",
  notifications: "Notifications",
  notification_curfew_lifted: "Overnight notifications",
};

const VALUE_LABELS: Record<string, string> = {
  off: "off",
  guardian_only: "guardians only",
  teammates: "teammates",
  peers: "peers",
  private: "private",
  guardian: "guardian review",
  members: "signed-in members",
  city: "city only",
  region: "region only",
};

function describeValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "string") return VALUE_LABELS[value] ?? value.replace(/_/g, " ");
  if (value === null || value === undefined) return "cleared";
  return String(value);
}

export type FamilyActivityDescription = { title: string; detail: string | null };

export function describeFamilyActivity(entry: {
  action: string;
  context?: Record<string, unknown> | null;
}): FamilyActivityDescription {
  const ctx = entry.context ?? {};

  switch (entry.action) {
    case "controls.created":
      return { title: "Safety settings created", detail: "Default protections applied." };
    case "controls.changed": {
      const parts = Object.entries(ctx).map(
        ([key, value]) =>
          `${CONTROL_LABELS[key] ?? key.replace(/_/g, " ")} → ${describeValue(value)}`,
      );
      return {
        title: "Safety settings changed",
        detail: parts.length > 0 ? parts.join(", ") : null,
      };
    }
    case "consent.pending":
      return { title: "Parental consent requested", detail: methodDetail(ctx) };
    case "consent.approved":
      return { title: "Parental consent approved", detail: methodDetail(ctx) };
    case "consent.revoked":
      return { title: "Parental consent withdrawn", detail: null };
    case "link.active":
      return { title: "Family link connected", detail: relationshipDetail(ctx) };
    case "link.pending":
      return { title: "Family link invited", detail: relationshipDetail(ctx) };
    case "link.revoked":
      return { title: "Family link ended", detail: null };
    case "family_post.team_shared":
      return { title: "Family clip shared with a team", detail: null };
    case "family_post.team_unshared":
      return { title: "Family clip made private again", detail: null };
    case "family_post.child_view_changed":
      return {
        title: "Child's view of family clips changed",
        detail: ctx["enabled"] === true ? "Your child can watch them" : "Your child can no longer watch them",
      };
    case "child.analytics_share_changed":
      return {
        title: "Analytics sharing with coaches changed",
        detail: ctx["enabled"] === true ? "Shared with a team's coaches" : "No longer shared with a team's coaches",
      };
    case "child.public_xp_changed":
      return {
        title: "Public level and XP changed",
        detail: ctx["enabled"] === true ? "Level, XP and milestone badges are shown on the Player Card" : "Level and XP are no longer shown publicly",
      };
    case "family_post.sharing_changed": {
      const what = ctx["kind"] === "team" ? "Team sharing" : "Private links";
      return {
        title: "Family clip sharing changed",
        detail: `${what} turned ${ctx["enabled"] === true ? "on" : "off"}`,
      };
    }
    case "family_post.link_created":
      return {
        title: "Private share link created",
        detail: typeof ctx["days"] === "number" ? `Valid for ${ctx["days"]} days` : null,
      };
    case "family_post.link_revoked":
      return { title: "Private share link turned off", detail: null };
    default:
      break;
  }

  if (entry.action.startsWith("consent.")) {
    return { title: `Consent ${entry.action.slice(8).replace(/_/g, " ")}`, detail: null };
  }
  if (entry.action.startsWith("link.")) {
    return { title: `Family link ${entry.action.slice(5).replace(/_/g, " ")}`, detail: null };
  }
  return { title: entry.action.replace(/[._]/g, " "), detail: null };
}

function methodDetail(ctx: Record<string, unknown>): string | null {
  const method = typeof ctx["method"] === "string" ? ctx["method"] : null;
  if (!method) return null;
  return method === "email" ? "By email confirmation" : `By ${method.replace(/_/g, " ")}`;
}

function relationshipDetail(ctx: Record<string, unknown>): string | null {
  const rel = typeof ctx["relationship"] === "string" ? ctx["relationship"] : null;
  return rel ? `Relationship: ${rel}` : null;
}
