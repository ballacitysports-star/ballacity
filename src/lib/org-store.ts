import { useEffect, useSyncExternalStore } from "react";
import { ORGS, type Org, type OrgKind, type Sport } from "./sample-data";
import { supabase } from "@/integrations/supabase/client";
import {
  createTeam,
  deleteTeam,
  listTeams,
  updateTeam,
} from "./teams.functions";

type TeamRow = {
  id: string;
  owner_id: string;
  kind: string;
  name: string;
  handle: string;
  tagline: string;
  city: string;
  founded: number | null;
  sports: string[];
  bio: string;
  achievements: string[];
  accent: string;
  avatar: string;
  cover: string;
  league: string | null;
  home_court: string | null;
  wins: number;
  losses: number;
  staff: unknown;
  credentials: string[];
  rate_per_hour: number | null;
  skill_min: number;
  skill_max: number;
  followers: number;
  verified: boolean;
};

const myOrgIds = new Set<string>();
const ownerByOrgId = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
let hydratePromise: Promise<void> | null = null;
let currentUserId: string | null = null;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

function rowToOrg(row: TeamRow): Org {
  const kind: OrgKind = row.kind === "coach" ? "coach" : "team";
  const staff = Array.isArray(row.staff)
    ? (row.staff as { name: string; role: string; avatar: string }[])
    : [];
  return {
    id: row.id,
    kind,
    name: row.name,
    handle: row.handle,
    tagline: row.tagline,
    city: row.city,
    founded: row.founded ?? new Date().getFullYear(),
    sports: (row.sports as Sport[]) ?? [],
    verified: row.verified,
    cover: row.cover,
    avatar: row.avatar,
    accent: row.accent,
    followers: row.followers,
    roster: kind === "team" ? staff.length : 0,
    bio: row.bio,
    achievements: row.achievements ?? [],
    credentials: kind === "coach" ? row.credentials ?? [] : undefined,
    ratePerHour: kind === "coach" ? row.rate_per_hour ?? undefined : undefined,
    rating: undefined,
    reviews: undefined,
    league: kind === "team" ? row.league ?? undefined : undefined,
    record: kind === "team" ? { w: row.wins, l: row.losses } : undefined,
    homeCourt: kind === "team" ? row.home_court ?? undefined : undefined,
    staff: kind === "team" ? staff : undefined,
    skillRange: { min: row.skill_min, max: row.skill_max },
    upcoming: [],
    posts: [],
  };
}

function orgToInsert(org: Org) {
  return {
    id: org.id,
    kind: org.kind,
    name: org.name,
    handle: org.handle,
    tagline: org.tagline,
    city: org.city,
    founded: org.founded,
    sports: org.sports,
    bio: org.bio,
    achievements: org.achievements,
    accent: org.accent,
    avatar: org.avatar,
    cover: org.cover,
    league: org.league ?? null,
    home_court: org.homeCourt ?? null,
    wins: org.record?.w ?? 0,
    losses: org.record?.l ?? 0,
    staff: org.staff ?? [],
    credentials: org.credentials ?? [],
    rate_per_hour: org.ratePerHour ?? null,
    skill_min: org.skillRange?.min ?? 1,
    skill_max: org.skillRange?.max ?? 5,
  };
}

function mergeRow(row: TeamRow) {
  const org = rowToOrg(row);
  ownerByOrgId.set(row.id, row.owner_id);
  if (currentUserId && row.owner_id === currentUserId) myOrgIds.add(row.id);
  const idx = ORGS.findIndex((o) => o.id === org.id);
  if (idx === -1) ORGS.unshift(org);
  else ORGS[idx] = { ...ORGS[idx], ...org };
}

async function refreshCurrentUser() {
  const { data } = await supabase.auth.getUser();
  currentUserId = data.user?.id ?? null;
  // Re-scan ownership map
  myOrgIds.clear();
  if (currentUserId) {
    for (const [id, owner] of ownerByOrgId) {
      if (owner === currentUserId) myOrgIds.add(id);
    }
  }
}

export async function hydrateOrgs(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      await refreshCurrentUser();
      const rows = (await listTeams()) as TeamRow[];
      for (const row of rows) mergeRow(row);
      emit();
    } catch (e) {
      console.error("[org-store] hydrate failed", e);
    }
  })();
  return hydratePromise;
}

// Re-hydrate on auth change so ownership flags flip immediately.
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
      hydratePromise = null;
      void hydrateOrgs();
    }
  });
}

export async function addOrg(org: Org): Promise<Org> {
  const row = (await createTeam({ data: orgToInsert(org) })) as TeamRow;
  mergeRow(row);
  emit();
  return rowToOrg(row);
}

export async function updateOrg(
  id: string,
  patch: Partial<Omit<Org, "id" | "kind" | "upcoming" | "posts">>,
): Promise<void> {
  // Only send DB-mapped fields
  const mapped: Record<string, unknown> = { id };
  if (patch.name !== undefined) mapped.name = patch.name;
  if (patch.handle !== undefined) mapped.handle = patch.handle;
  if (patch.tagline !== undefined) mapped.tagline = patch.tagline;
  if (patch.city !== undefined) mapped.city = patch.city;
  if (patch.founded !== undefined) mapped.founded = patch.founded;
  if (patch.sports !== undefined) mapped.sports = patch.sports;
  if (patch.bio !== undefined) mapped.bio = patch.bio;
  if (patch.achievements !== undefined) mapped.achievements = patch.achievements;
  if (patch.accent !== undefined) mapped.accent = patch.accent;
  if (patch.avatar !== undefined) mapped.avatar = patch.avatar;
  if (patch.cover !== undefined) mapped.cover = patch.cover;
  if (patch.league !== undefined) mapped.league = patch.league ?? null;
  if (patch.homeCourt !== undefined) mapped.home_court = patch.homeCourt ?? null;
  if (patch.record !== undefined) {
    mapped.wins = patch.record?.w ?? 0;
    mapped.losses = patch.record?.l ?? 0;
  }
  if (patch.staff !== undefined) mapped.staff = patch.staff ?? [];
  if (patch.credentials !== undefined) mapped.credentials = patch.credentials ?? [];
  if (patch.ratePerHour !== undefined) mapped.rate_per_hour = patch.ratePerHour ?? null;
  if (patch.skillRange !== undefined) {
    mapped.skill_min = patch.skillRange?.min ?? 1;
    mapped.skill_max = patch.skillRange?.max ?? 5;
  }

  const row = (await updateTeam({ data: mapped as never })) as TeamRow;
  mergeRow(row);
  emit();
}

export async function deleteOrg(id: string): Promise<void> {
  await deleteTeam({ data: { id } });
  const idx = ORGS.findIndex((o) => o.id === id);
  if (idx !== -1) ORGS.splice(idx, 1);
  myOrgIds.delete(id);
  ownerByOrgId.delete(id);
  emit();
}

export function getOrgById(id: string): Org | undefined {
  return ORGS.find((o) => o.id === id);
}

/** Async lookup that falls back to a DB fetch if the id isn't in the local cache. */
export async function ensureOrgById(id: string): Promise<Org | undefined> {
  const local = getOrgById(id);
  if (local) return local;
  await hydrateOrgs();
  return getOrgById(id);
}

export function isMyOrg(id: string): boolean {
  return myOrgIds.has(id);
}

export function getMyOrgs(): Org[] {
  return ORGS.filter((o) => myOrgIds.has(o.id));
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useMyOrgs(): Org[] {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  useEffect(() => {
    void hydrateOrgs();
  }, []);
  return getMyOrgs();
}

export function useAllOrgs(): Org[] {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  useEffect(() => {
    void hydrateOrgs();
  }, []);
  return ORGS;
}
