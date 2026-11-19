/**
 * WP 3.2b: a host's private named lists of their regulars ("Tuesday crew"), migration 20261124100000. Only the host reads
 * or changes them; only a current regular can be added; inviting a list goes through game_invite_players, so every invitation
 * rule still applies.
 */
import { supabase } from "@/integrations/supabase/client";

export type HostGroup = { id: string; name: string; memberIds: string[] };

export const GROUP_NAME_MAX = 60;
export const GROUP_MEMBERS_MAX = 50;

type Row = { id: string; name: string; host_group_members: { user_id: string }[] | null };

/** The signed-in host's lists, by name. */
export async function listMyHostGroups(): Promise<HostGroup[]> {
  const t = supabase.from("host_groups" as never) as unknown as {
    select: (c: string) => {
      order: (col: string) => Promise<{ data: Row[] | null; error: unknown }>;
    };
  };
  const { data, error } = await t.select("id, name, host_group_members(user_id)").order("name");
  if (error) throw error;
  return (data ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    memberIds: (g.host_group_members ?? []).map((m) => m.user_id),
  }));
}

/** A trimmed name, or an error message. */
export function groupNameError(name: string, existing: readonly HostGroup[]): string | null {
  const n = name.trim();
  if (!n) return "Give the group a name.";
  if (n.length > GROUP_NAME_MAX) return `Keep the name to ${GROUP_NAME_MAX} characters.`;
  if (existing.some((g) => g.name.trim().toLowerCase() === n.toLowerCase()))
    return "You already have a group with that name.";
  return null;
}

/** Create a list with these people (at most 50). People who are no longer the host's regulars are refused by the database. */
export async function createHostGroup(name: string, memberIds: readonly string[]): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sign in first.");
  const groups = supabase.from("host_groups" as never) as unknown as {
    insert: (r: unknown) => {
      select: (c: string) => {
        single: () => Promise<{ data: { id: string } | null; error: unknown }>;
      };
    };
  };
  const { data, error } = await groups
    .insert({ host_id: auth.user.id, name: name.trim() })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Couldn't create the group.");
  const ids = Array.from(new Set(memberIds)).slice(0, GROUP_MEMBERS_MAX);
  if (ids.length > 0) {
    const members = supabase.from("host_group_members" as never) as unknown as {
      insert: (r: unknown) => Promise<{ error: unknown }>;
    };
    const { error: mErr } = await members.insert(
      ids.map((user_id) => ({ group_id: data.id, user_id })),
    );
    if (mErr) throw mErr;
  }
  return data.id;
}

export async function deleteHostGroup(groupId: string): Promise<void> {
  const t = supabase.from("host_groups" as never) as unknown as {
    delete: () => { eq: (c: string, v: string) => Promise<{ error: unknown }> };
  };
  const { error } = await t.delete().eq("id", groupId);
  if (error) throw error;
}
