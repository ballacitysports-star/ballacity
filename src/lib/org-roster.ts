/**
 * Public shapes for a facility's trainer roster. `trainer_org_members` is
 * locked down in the database (it holds user ids), so the app reads it with
 * the service role. These helpers are the choke point that decides what may
 * leave the server: public trainer fields only, never user ids, and nothing
 * for hidden trainer profiles or hidden facilities.
 */

export type PublicRosterMember = {
  id: string;
  trainer_id: string;
  role: string;
  joined_at: string;
  teams: {
    id: string;
    name: string;
    handle: string;
    avatar: string | null;
    city: string | null;
    sports: string[] | null;
  };
};

type RawTeam = {
  id: string;
  name: string;
  handle: string;
  avatar: string | null;
  city: string | null;
  sports: string[] | null;
  hidden_at?: string | null;
};

export type RawRosterRow = {
  id: string;
  trainer_id: string;
  role: string;
  joined_at: string;
  teams: RawTeam | null;
  // Present on raw rows from the table; must never be copied through.
  user_id?: string;
};

export function toPublicRoster(rows: readonly RawRosterRow[]): PublicRosterMember[] {
  const out: PublicRosterMember[] = [];
  for (const m of rows) {
    const t = m.teams;
    if (!t || t.hidden_at) continue;
    out.push({
      id: m.id,
      trainer_id: m.trainer_id,
      role: m.role,
      joined_at: m.joined_at,
      teams: {
        id: t.id,
        name: t.name,
        handle: t.handle,
        avatar: t.avatar,
        city: t.city,
        sports: t.sports,
      },
    });
  }
  return out;
}

export type PublicTrainerOrg = {
  id: string;
  name: string;
  handle: string;
  avatar: string | null;
  city: string | null;
  verified: boolean | null;
};

type RawOrg = PublicTrainerOrg & { hidden_at?: string | null };

/** The first visible facility a trainer belongs to (oldest membership first). */
export function firstVisibleOrgLink(
  rows: ReadonlyArray<{ role: string; org: RawOrg | null }>,
): { role: string; org: PublicTrainerOrg } | null {
  for (const r of rows) {
    const o = r.org;
    if (!o || o.hidden_at) continue;
    return {
      role: r.role,
      org: {
        id: o.id,
        name: o.name,
        handle: o.handle,
        avatar: o.avatar,
        city: o.city,
        verified: o.verified,
      },
    };
  }
  return null;
}

type RawTrainerFacilityRow = {
  trainer_id: string;
  org: { id: string; name: string; hidden_at?: string | null } | null;
};

/**
 * The facility each trainer works at, for the trainers directory: the first
 * visible one per trainer (rows should arrive oldest membership first). Public
 * fields only, so no user ids, and hidden facilities are skipped.
 */
export function facilityByTrainer(
  rows: readonly RawTrainerFacilityRow[],
): Record<string, { id: string; name: string }> {
  const out: Record<string, { id: string; name: string }> = {};
  for (const r of rows) {
    if (!r.org || r.org.hidden_at || out[r.trainer_id]) continue;
    out[r.trainer_id] = { id: r.org.id, name: r.org.name };
  }
  return out;
}
