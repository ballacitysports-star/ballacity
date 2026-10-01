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

/**
 * The one question put to a new member: what are you here to do?
 *
 * A *role* is what someone recognises themselves as: four cards, the same at
 * sign-up and in onboarding. A *setup* is the first thing they do about it and
 * the only thing that decides where they go next: Team / Coach is one role with
 * two setups, the others have one. Choosing a setup sends the member straight to
 * the screen that creates it, with no second question in between.
 *
 * Neither is an account type. The database holds four (player, team, trainer,
 * gym) and accounts hold several profile kinds, so each setup stores the closest
 * account type. A parent is stored as a player and is never asked an athlete's
 * questions.
 */
export type SetupId = "player" | "child" | "team" | "coach" | "facility";
export type RoleId = "player" | "parent" | "team_coach" | "facility";

export type SetupMeta = {
  /** What `profiles.account_type` holds once this setup is chosen. */
  accountType: AccountType;
  /** The screen that does the setup. */
  to: string;
  search?: { from: string };
  label: string;
  blurb?: string;
};

export const SETUPS: Record<SetupId, SetupMeta> = {
  player: { accountType: "player", to: "/onboarding/welcome", label: "Player" },
  child: {
    accountType: "player",
    to: "/players/add",
    search: { from: "onboarding" },
    label: "Add your child",
  },
  team: {
    accountType: "team",
    to: "/teams/create",
    label: "Team",
    blurb: "Set up a squad and its roster",
  },
  coach: {
    accountType: "trainer",
    to: "/trainers/create",
    label: "Coach",
    blurb: "Offer sessions and manage your availability",
  },
  facility: { accountType: "gym", to: "/orgs/create", label: "Facility / Gym" },
};

export type RoleMeta = {
  id: RoleId;
  emoji: string;
  label: string;
  blurb: string;
  setups: readonly SetupId[];
  /** Everything a parent or guardian sets up needs an adult. */
  adultsOnly?: true;
};

export const ROLES: readonly RoleMeta[] = [
  {
    id: "player",
    emoji: "🏃",
    label: "Player",
    blurb: "Athletes looking for games and runs",
    setups: ["player"],
  },
  {
    id: "parent",
    emoji: "👪",
    label: "Parent / Guardian",
    blurb: "Parents managing kids' sports schedules",
    setups: ["child"],
    adultsOnly: true,
  },
  {
    id: "team_coach",
    emoji: "👥",
    label: "Team / Coach",
    blurb: "Coaches and captains organizing squads",
    setups: ["team", "coach"],
  },
  {
    id: "facility",
    emoji: "🏢",
    label: "Facility / Gym",
    blurb: "Venue owners and sports facilities",
    setups: ["facility"],
  },
];

export function isSetupId(v: unknown): v is SetupId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SETUPS, v);
}

export function roleOfSetup(setup: SetupId): RoleMeta {
  return ROLES.find((r) => r.setups.includes(setup)) ?? ROLES[0];
}

/** What `profiles.account_type` holds for a setup. */
export function accountTypeForSetup(setup: SetupId): AccountType {
  return SETUPS[setup].accountType;
}

/** Where a setup goes, as a router target. */
export function routeForSetup(setup: SetupId): { to: string; search?: { from: string } } {
  const { to, search } = SETUPS[setup];
  return search ? { to, search } : { to };
}

/** Where a setup goes, as a path for a full-page navigation. */
export function hrefForSetup(setup: SetupId): string {
  const { to, search } = SETUPS[setup];
  return search ? `${to}?${new URLSearchParams(search).toString()}` : to;
}

/**
 * Adults only for a parent or guardian: a managed child needs one, and the
 * server refuses anyone else. This keeps the option from being offered.
 */
export function canChooseRole(role: RoleId, cohort: string | null | undefined): boolean {
  const meta = ROLES.find((r) => r.id === role);
  return !meta?.adultsOnly || cohort === "adult";
}

/**
 * Sign-up metadata key carrying the chosen setup across email confirmation, which
 * can finish on another device where sessionStorage is gone. It only routes;
 * nothing trusts it.
 */
export const START_AS_KEY = "start_as";

/**
 * The setup a signed-in user still has to start, if any. "manager" is what the
 * short-lived Parent / Guardian / Owner sign-up stored; it was a parent.
 */
export function startSetupOf(
  user: { user_metadata?: Record<string, unknown> | null } | null | undefined,
): SetupId | null {
  const v = user?.user_metadata?.[START_AS_KEY];
  if (v === "manager") return "child";
  return isSetupId(v) ? v : null;
}

/** Forget the sign-up hint once it has sent the member to their setup. Best effort. */
export async function clearStartHint(): Promise<void> {
  try {
    await supabase.auth.updateUser({ data: { [START_AS_KEY]: null } });
  } catch {
    /* it only routes: a stale hint costs one extra redirect, never access */
  }
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
