import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { ACCOUNT_TYPE_META, isAccountType, type AccountType } from "@/lib/account-type";

/**
 * An account can hold several profiles at once: one personal player profile
 * (always present) plus any number of team, trainer, and gym profiles. The
 * `account_profiles` table lists them and `profiles.active_profile_id` points
 * at the one the user is currently acting as.
 */
export type AccountProfile = {
  id: string;
  kind: AccountType;
  /** teams.id / trainer_orgs.id for linked profiles, null for the player profile. */
  refId: string | null;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  avatarFallback: string;
  /** Where to open this profile. */
  href: { to: string; params?: Record<string, string> };
};

export type MyProfilesResult = {
  profiles: AccountProfile[];
  activeId: string | null;
  active: AccountProfile | null;
  /** Profile the app starts in on any device / new session. */
  defaultId: string | null;
};


function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export const myProfilesKey = (userId: string | null | undefined) => [
  "my-account-profiles",
  userId ?? "anon",
];

async function fetchMyProfiles(userId: string): Promise<MyProfilesResult> {
  const [{ data: rows }, { data: me }] = await Promise.all([
    supabase
      .from("account_profiles")
      .select("id, kind, ref_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("profiles")
      .select("display_name, username, avatar_url, avatar_initials, active_profile_id")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  const list = (rows ?? []) as {
    id: string;
    kind: string;
    ref_id: string | null;
  }[];

  const teamRefs = list
    .filter((r) => (r.kind === "team" || r.kind === "trainer") && r.ref_id)
    .map((r) => r.ref_id as string);
  const orgRefs = list.filter((r) => r.kind === "gym" && r.ref_id).map((r) => r.ref_id as string);

  const [teamsRes, orgsRes] = await Promise.all([
    teamRefs.length
      ? supabase.from("teams").select("id, name, handle, avatar").in("id", teamRefs)
      : Promise.resolve({ data: [] as unknown[] }),
    orgRefs.length
      ? supabase.from("trainer_orgs").select("id, name, handle, avatar, avatar_url").in("id", orgRefs)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const teams = new Map(
    ((teamsRes.data ?? []) as { id: string; name: string; handle: string; avatar: string }[]).map(
      (t) => [t.id, t],
    ),
  );
  const orgs = new Map(
    (
      (orgsRes.data ?? []) as {
        id: string;
        name: string;
        handle: string;
        avatar: string | null;
        avatar_url: string | null;
      }[]
    ).map((o) => [o.id, o]),
  );

  const profile = (me ?? null) as {
    display_name?: string;
    username?: string | null;
    avatar_url?: string | null;
    avatar_initials?: string | null;
    active_profile_id?: string | null;
  } | null;

  const profiles: AccountProfile[] = [];
  for (const row of list) {
    if (!isAccountType(row.kind)) continue;
    if (row.kind === "player") {
      const name = profile?.display_name || "My profile";
      profiles.push({
        id: row.id,
        kind: "player",
        refId: null,
        name,
        handle: profile?.username ?? null,
        avatarUrl: profile?.avatar_url ?? null,
        avatarFallback: profile?.avatar_initials || initials(name),
        href: { to: "/profile" },
      });
      continue;
    }
    if (row.kind === "gym") {
      const org = row.ref_id ? orgs.get(row.ref_id) : undefined;
      if (!org) continue;
      profiles.push({
        id: row.id,
        kind: "gym",
        refId: org.id,
        name: org.name,
        handle: org.handle,
        avatarUrl: org.avatar_url ?? null,
        avatarFallback: org.avatar || initials(org.name),
        href: { to: "/orgs/$orgId", params: { orgId: org.id } },
      });
      continue;
    }
    const team = row.ref_id ? teams.get(row.ref_id) : undefined;
    if (!team) continue;
    profiles.push({
      id: row.id,
      kind: row.kind,
      refId: team.id,
      name: team.name,
      handle: team.handle,
      avatarUrl: null,
      avatarFallback: team.avatar || initials(team.name),
      href: { to: "/teams/$teamId", params: { teamId: team.id } },
    });
  }

  // Player profile always first.
  profiles.sort((a, b) => (a.kind === "player" ? -1 : b.kind === "player" ? 1 : 0));

  const activeId = profile?.active_profile_id ?? profiles[0]?.id ?? null;
  return {
    profiles,
    activeId,
    active: profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null,
  };
}

export function useMyProfiles() {
  const { user, loading } = useAuth();
  const query = useQuery({
    queryKey: myProfilesKey(user?.id),
    queryFn: () => fetchMyProfiles(user!.id),
    enabled: !!user && !loading,
    staleTime: 30_000,
  });
  return {
    profiles: query.data?.profiles ?? [],
    active: query.data?.active ?? null,
    activeId: query.data?.activeId ?? null,
    loading: loading || query.isLoading,
    refetch: query.refetch,
  };
}

export function useActiveProfile() {
  const { active, loading } = useMyProfiles();
  return { active, loading };
}

/**
 * Points `profiles.active_profile_id` at the given account profile and keeps
 * `profiles.account_type` mirrored so existing account-type reads stay correct.
 */
export async function setActiveProfile(profile: AccountProfile): Promise<void> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) throw new Error("Not signed in");
  const { error } = await supabase
    .from("profiles")
    .update({ active_profile_id: profile.id, account_type: profile.kind })
    .eq("id", uid);
  if (error) throw error;
}

/** Switches into a freshly created team/trainer/gym profile by its linked id. */
export async function setActiveProfileByRef(kind: AccountType, refId: string): Promise<void> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) return;
  const { data } = await supabase
    .from("account_profiles")
    .select("id")
    .eq("user_id", uid)
    .eq("kind", kind)
    .eq("ref_id", refId)
    .maybeSingle();
  const id = (data as { id?: string } | null)?.id;
  if (!id) return;
  await supabase
    .from("profiles")
    .update({ active_profile_id: id, account_type: kind })
    .eq("id", uid);
}

export function useSwitchProfile() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (profile: AccountProfile) => setActiveProfile(profile),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: myProfilesKey(user?.id) });
      await qc.invalidateQueries();
    },
  });
}

export function profileTypeLabel(kind: AccountType): string {
  return ACCOUNT_TYPE_META[kind].label;
}

/** Route for adding another profile of a given type. */
export function addProfileRoute(kind: Exclude<AccountType, "player">): string {
  return kind === "team" ? "/teams/create" : kind === "trainer" ? "/trainers/create" : "/orgs/create";
}
