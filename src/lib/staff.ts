/**
 * Staff tiers and where each one lands. Pure so the dispatcher, the top-bar
 * switcher and Settings all agree. The server decides the flags (see
 * `getMyStaffAccess`); nothing here grants access, it only chooses links.
 */
export type StaffTier = "superadmin" | "admin" | "moderator";

export type StaffAccess = {
  isSuperadmin: boolean;
  isAdmin: boolean;
  isModerator: boolean;
};

export const NO_STAFF_ACCESS: StaffAccess = {
  isSuperadmin: false,
  isAdmin: false,
  isModerator: false,
};

export type StaffDashboard = {
  tier: StaffTier;
  to: string;
  label: string;
  description: string;
};

const DASHBOARDS: Record<StaffTier, StaffDashboard> = {
  superadmin: {
    tier: "superadmin",
    to: "/superadmin",
    label: "Control center",
    description: "Users, content, payments, queues and configuration",
  },
  admin: {
    tier: "admin",
    to: "/admin",
    label: "Admin panel",
    description: "Moderation, compliance, legal and listings",
  },
  moderator: {
    tier: "moderator",
    to: "/admin/moderation",
    label: "Moderation queue",
    description: "Reports and flagged content",
  },
};

export const STAFF_TIER_LABEL: Record<StaffTier, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
  moderator: "Moderator",
};

/** Highest tier the account holds, or null for non-staff. */
export function staffTierOf(access: StaffAccess): StaffTier | null {
  if (access.isSuperadmin) return "superadmin";
  if (access.isAdmin) return "admin";
  if (access.isModerator) return "moderator";
  return null;
}

/** Every dashboard the account may open, highest tier first. */
export function staffDashboards(access: StaffAccess): StaffDashboard[] {
  const out: StaffDashboard[] = [];
  if (access.isSuperadmin) out.push(DASHBOARDS.superadmin);
  if (access.isSuperadmin || access.isAdmin) out.push(DASHBOARDS.admin);
  if (access.isSuperadmin || access.isAdmin || access.isModerator) out.push(DASHBOARDS.moderator);
  return out;
}

/** Where the post-login dispatcher sends this account. */
export function staffHomeFor(access: StaffAccess): string | null {
  return staffDashboards(access)[0]?.to ?? null;
}

/** The badge and quick switcher are shown to active admins and superadmins. */
export function showsStaffChrome(access: StaffAccess): boolean {
  return access.isSuperadmin || access.isAdmin;
}
