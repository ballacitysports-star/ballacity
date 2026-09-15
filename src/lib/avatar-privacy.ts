import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invalidateUserAvatar } from "@/lib/user-avatars";

export type AvatarVisibility = "public" | "members" | "game_members";

export const AVATAR_VISIBILITY_OPTIONS: Array<{
  value: AvatarVisibility;
  label: string;
  description: string;
}> = [
  {
    value: "public",
    label: "Everyone",
    description: "Anyone browsing the app or a shared link can see your photo.",
  },
  {
    value: "members",
    label: "Signed-in members",
    description: "Only people with an account see your photo. Visitors see your initials.",
  },
  {
    value: "game_members",
    label: "Game & chat members only",
    description: "Only players you share a game with — or are chatting with — see your photo.",
  },
];

export const DEFAULT_AVATAR_VISIBILITY: AvatarVisibility = "public";

export function avatarVisibilityLabel(value: AvatarVisibility | null | undefined): string {
  return (
    AVATAR_VISIBILITY_OPTIONS.find((o) => o.value === (value ?? DEFAULT_AVATAR_VISIBILITY))
      ?.label ?? "Everyone"
  );
}

/** Reads and updates the signed-in user's profile-photo visibility choice. */
export function useAvatarVisibility() {
  const [value, setValue] = useState<AvatarVisibility | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase
        .from("profiles")
        .select("avatar_visibility")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (cancelled) return;
      setValue(((data as any)?.avatar_visibility as AvatarVisibility) ?? DEFAULT_AVATAR_VISIBILITY);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(
    async (next: AvatarVisibility) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sign in to change privacy settings");
      const prev = value;
      setValue(next);
      setSaving(true);
      try {
        const { error } = await supabase
          .from("profiles")
          .update({ avatar_visibility: next } as any)
          .eq("id", auth.user.id);
        if (error) throw error;
        invalidateUserAvatar();
      } catch (e) {
        setValue(prev);
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [value],
  );

  return { value, saving, update };
}
