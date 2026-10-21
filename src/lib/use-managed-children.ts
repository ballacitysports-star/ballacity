import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  createManagedChild,
  createPairingLink,
  deleteManagedChild,
  revokeChildDevices,
  startManagedSession,
  type CreatedManagedChild,
} from "@/lib/managed-children.functions";
import type { GuardianRelationship } from "@/lib/managed-children";
import { useMyProfiles } from "@/lib/account-profiles";
import { switchToManagedChild } from "@/lib/managed-session";

export function useCreateManagedChild() {
  const fn = useServerFn(createManagedChild);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      firstName: string;
      lastName?: string;
      dateOfBirth: string;
      sport?: string;
      relationship: GuardianRelationship;
      fromPlayerProfileId?: string;
    }): Promise<CreatedManagedChild> => fn({ data: { ...input, attested: true } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["guardian-children"] });
      void qc.invalidateQueries({ queryKey: ["unfinished-child-profiles"] });
    },
  });
}

export function useDeleteManagedChild() {
  const fn = useServerFn(deleteManagedChild);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { childUserId: string }) => fn({ data: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["guardian-children"] });
    },
  });
}

/**
 * Switch this device into a managed child's profile. Ends in a full page
 * load, so a successful call never resolves back into the guardian's UI.
 */
export function useSwitchToManagedChild() {
  const fn = useServerFn(startManagedSession);
  const { profiles } = useMyProfiles();
  const guardianName = profiles.find((p) => p.kind === "player")?.name ?? null;
  return useMutation({
    mutationFn: async (input: { childUserId: string; childName: string }) => {
      const { tokenHash } = await fn({ data: { childUserId: input.childUserId } });
      await switchToManagedChild({ ...input, tokenHash, guardianName });
    },
  });
}

/** Make a one-time link for the child's own phone (see `createPairingLink`). */
export function useCreatePairingLink() {
  const fn = useServerFn(createPairingLink);
  return useMutation({
    mutationFn: (input: { childUserId: string }) => fn({ data: input }),
  });
}

/** Sign the child out of every device. */
export function useRevokeChildDevices() {
  const fn = useServerFn(revokeChildDevices);
  return useMutation({
    mutationFn: (input: { childUserId: string }) => fn({ data: input }),
  });
}

export type UnfinishedChildProfile = {
  id: string;
  firstName: string;
  lastName: string | null;
  dateOfBirth: string | null;
  sport: string | null;
};

/**
 * Children a parent started on the old Add Player screen. Those rows were
 * login-less `player_profiles` entries that nothing in the app read, so the
 * parent never saw them again. They are listed so the parent can finish
 * setting each one up as a real managed profile.
 */
export function useUnfinishedChildProfiles() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["unfinished-child-profiles", user?.id ?? "anon"],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<UnfinishedChildProfile[]> => {
      const { data, error } = await supabase
        .from("player_profiles")
        .select("id, first_name, last_name, display_name, date_of_birth, primary_sport, user_id")
        .eq("account_id", user!.id)
        .is("user_id", null)
        .order("created_at", { ascending: true });
      // A missing table (not yet migrated) is not an error worth surfacing.
      if (error || !data) return [];
      return (
        data as {
          id: string;
          first_name: string | null;
          last_name: string | null;
          display_name: string;
          date_of_birth: string | null;
          primary_sport: string | null;
        }[]
      ).map((r) => ({
        id: r.id,
        firstName: r.first_name || r.display_name.split(" ")[0] || "",
        lastName: r.last_name,
        dateOfBirth: r.date_of_birth,
        sport: r.primary_sport,
      }));
    },
  });
}

/** One unfinished row, for prefilling the Add your child form. */
export async function fetchUnfinishedChildProfile(
  id: string,
): Promise<UnfinishedChildProfile | null> {
  const { data } = await supabase
    .from("player_profiles")
    .select("id, first_name, last_name, display_name, date_of_birth, primary_sport")
    .eq("id", id)
    .is("user_id", null)
    .maybeSingle();
  if (!data) return null;
  const r = data as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    display_name: string;
    date_of_birth: string | null;
    primary_sport: string | null;
  };
  return {
    id: r.id,
    firstName: r.first_name || r.display_name.split(" ")[0] || "",
    lastName: r.last_name,
    dateOfBirth: r.date_of_birth,
    sport: r.primary_sport,
  };
}
