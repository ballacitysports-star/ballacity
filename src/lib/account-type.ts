import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type AccountType = "player" | "team" | "trainer" | "gym";

export const ACCOUNT_TYPES: AccountType[] = ["player", "team", "trainer", "gym"];

export const ACCOUNT_TYPE_META: Record<
  AccountType,
  { label: string; plural: string; emoji: string; blurb: string }
> = {
  player: {
    label: "Player",
    plural: "Players",
    emoji: "🏃",
    blurb: "Find games, join teams, and track your reputation.",
  },
  team: {
    label: "Team",
    plural: "Teams",
    emoji: "👥",
    blurb: "Host games and manage your roster as a team.",
  },
  trainer: {
    label: "Trainer",
    plural: "Trainers",
    emoji: "🎯",
    blurb: "Offer sessions and manage your availability.",
  },
  gym: {
    label: "Gym",
    plural: "Gyms",
    emoji: "🏢",
    blurb: "Run a gym with trainers and members.",
  },
};

export function isAccountType(v: unknown): v is AccountType {
  return typeof v === "string" && (ACCOUNT_TYPES as string[]).includes(v);
}

const PENDING_KEY = "openrun.pending_account_type";

export function setPendingAccountType(t: AccountType) {
  try {
    sessionStorage.setItem(PENDING_KEY, t);
  } catch {
    /* ignore */
  }
}

export function readPendingAccountType(): AccountType | null {
  try {
    const v = sessionStorage.getItem(PENDING_KEY);
    return isAccountType(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearPendingAccountType() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Reads the current user's account_type from the profiles table.
 * Returns null while loading or if no user is signed in.
 */
export function useAccountType(): {
  accountType: AccountType | null;
  loading: boolean;
  refetch: () => void;
} {
  const { user, loading: authLoading } = useAuth();
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setAccountType(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase
      .from("profiles")
      .select("account_type")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const t = (data as { account_type?: string } | null)?.account_type;
        setAccountType(isAccountType(t) ? t : null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, tick]);

  return { accountType, loading: authLoading || loading, refetch: () => setTick((n) => n + 1) };
}

export async function setAccountTypeForCurrentUser(type: AccountType): Promise<void> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) throw new Error("Not signed in");
  const { error } = await supabase.from("profiles").update({ account_type: type }).eq("id", uid);
  if (error) throw error;
}
