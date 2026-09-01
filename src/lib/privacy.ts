import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Privacy preferences — single source of truth for the app's privacy controls.
 *
 * Defaults are deliberately conservative for location (approximate only) while
 * keeping the social product usable out of the box. Nothing here is a legal
 * compliance guarantee; see /account/legal (LEGAL REVIEW REQUIRED).
 */

export type ProfileVisibility = "public" | "members" | "private";
export type LocationPrecision = "approximate" | "city" | "hidden";
export type ContactScope = "everyone" | "shared" | "nobody";

export type PrivacyPreferences = {
  profile_visibility: ProfileVisibility;
  location_precision: LocationPrecision;
  show_sports: boolean;
  show_games_played: boolean;
  allow_messages: ContactScope;
  allow_invites: ContactScope;
  marketing_emails: boolean;
  ai_processing: boolean;
};

export const DEFAULT_PRIVACY: PrivacyPreferences = {
  profile_visibility: "public",
  location_precision: "approximate",
  show_sports: true,
  show_games_played: true,
  allow_messages: "everyone",
  allow_invites: "everyone",
  marketing_emails: false,
  ai_processing: true,
};

export const PROFILE_VISIBILITY_OPTIONS: Array<{
  value: ProfileVisibility;
  label: string;
  description: string;
}> = [
  {
    value: "public",
    label: "Everyone",
    description: "Anyone, including visitors without an account, can open your profile.",
  },
  {
    value: "members",
    label: "Signed-in members",
    description: "Only people signed in to OpenRun can open your profile.",
  },
  {
    value: "private",
    label: "Only me",
    description: "Your profile is hidden from everyone else. You can still join games.",
  },
];

export const LOCATION_PRECISION_OPTIONS: Array<{
  value: LocationPrecision;
  label: string;
  description: string;
}> = [
  {
    value: "approximate",
    label: "Approximate area",
    description:
      "Your availability is matched using a ~1 km area, never a street address or live position.",
  },
  {
    value: "city",
    label: "City only",
    description: "Only your city is shared. Distance-based matching becomes less precise.",
  },
  {
    value: "hidden",
    label: "Hidden",
    description: "No location is shared. You won't appear in nearby results.",
  },
];

export const CONTACT_SCOPE_OPTIONS: Array<{
  value: ContactScope;
  label: string;
}> = [
  { value: "everyone", label: "Everyone" },
  { value: "shared", label: "Shared games or chats" },
  { value: "nobody", label: "No one" },
];

export function privacyLabel<T extends string>(
  options: Array<{ value: T; label: string }>,
  value: T,
): string {
  return options.find((o) => o.value === value)?.label ?? String(value);
}

const QUERY_KEY = ["privacy-preferences"] as const;

/** Reads and updates the signed-in user's privacy preferences. */
export function useMyPrivacy() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<PrivacyPreferences> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return DEFAULT_PRIVACY;
      const { data, error } = await supabase
        .from("privacy_preferences" as never)
        .select("*")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (error) throw error;
      return { ...DEFAULT_PRIVACY, ...((data ?? {}) as Partial<PrivacyPreferences>) };
    },
  });

  const mutation = useMutation({
    mutationFn: async (patch: Partial<PrivacyPreferences>) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sign in to change privacy settings");
      const next = { ...(query.data ?? DEFAULT_PRIVACY), ...patch };
      const { error } = await supabase
        .from("privacy_preferences" as never)
        .upsert({ user_id: auth.user.id, ...next } as never, { onConflict: "user_id" });
      if (error) throw error;
      return next;
    },
    onMutate: (patch) => {
      qc.setQueryData(QUERY_KEY, { ...(query.data ?? DEFAULT_PRIVACY), ...patch });
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const update = useCallback(
    (patch: Partial<PrivacyPreferences>) => mutation.mutateAsync(patch),
    [mutation],
  );

  return {
    prefs: query.data ?? DEFAULT_PRIVACY,
    isLoading: query.isLoading,
    saving: mutation.isPending,
    update,
  };
}

export type PublicPrivacyFlags = { show_sports: boolean; show_games_played: boolean };

/**
 * What another viewer is allowed to see on a player's public card. Only the two
 * display flags are exposed by the database helper — nothing else leaks.
 */
export function usePublicPrivacyFlags(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["public-privacy-flags", userId],
    enabled: !!userId,
    queryFn: async (): Promise<PublicPrivacyFlags> => {
      const { data, error } = await (supabase.rpc as never as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>)("public_privacy_flags", {
        _ids: [userId],
      });
      if (error) return { show_sports: true, show_games_played: true };
      const row = ((data ?? []) as PublicPrivacyFlags[])[0];
      return {
        show_sports: row?.show_sports ?? true,
        show_games_played: row?.show_games_played ?? true,
      };
    },
  });
}
