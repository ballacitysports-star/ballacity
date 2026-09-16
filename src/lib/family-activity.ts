/**
 * Plain-language labels for the append-only Guardian activity trail.
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
      return { title: "Guardian consent requested", detail: methodDetail(ctx) };
    case "consent.approved":
      return { title: "Guardian consent approved", detail: methodDetail(ctx) };
    case "consent.revoked":
      return { title: "Guardian consent withdrawn", detail: null };
    case "link.active":
      return { title: "Guardian link connected", detail: relationshipDetail(ctx) };
    case "link.pending":
      return { title: "Guardian link invited", detail: relationshipDetail(ctx) };
    case "link.revoked":
      return { title: "Guardian link ended", detail: null };
    default:
      break;
  }

  if (entry.action.startsWith("consent.")) {
    return { title: `Consent ${entry.action.slice(8).replace(/_/g, " ")}`, detail: null };
  }
  if (entry.action.startsWith("link.")) {
    return { title: `Guardian link ${entry.action.slice(5).replace(/_/g, " ")}`, detail: null };
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
