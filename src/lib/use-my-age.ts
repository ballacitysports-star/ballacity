import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserId } from "@/lib/current-user-id";
import { useAuth } from "@/hooks/use-auth";

function ageFromBirthday(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * The signed-in viewer's age, derived from their profile birthday via the
 * `get_my_birthday` RPC (birthdays aren't readable through a plain select).
 * `null` means "not shared / unknown".
 *
 * `error` is true when the read failed (the RPC answered an error or threw):
 * `age` is then null as well, so callers that treat a failure as "unknown"
 * keep doing so, and a caller that must not (the pay page's age range, which
 * would otherwise say "Add your birthday") can offer `retry` instead.
 *
 * The answer belongs to the account that is signed in now (useAuth): when the
 * account changes without a remount (a sign-in in another tab reaches this one
 * through the session storage event), it is `loading` again, with no age, until
 * the new account's birthday has been read. The pay page gates on it, so the
 * previous account's age must never judge the new one against a game's range.
 */
export function useMyAge(): {
  age: number | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
} {
  const { user } = useAuth();
  const [attempt, setAttempt] = useState(0);
  // Which account and attempt the answer was read for; any other key is still loading.
  const key = `${user?.id ?? ""}#${attempt}`;
  const [result, setResult] = useState<{ key: string; age: number | null; error: boolean } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    const settle = (age: number | null, error: boolean) => {
      if (!cancelled) setResult({ key, age, error });
    };
    const load = async () => {
      try {
        if (!(await getCurrentUserId())) {
          settle(null, false);
          return;
        }
        const { data, error: rpcError } = await (supabase.rpc as any)("get_my_birthday");
        const iso = typeof data === "string" ? data : null;
        settle(iso ? ageFromBirthday(iso) : null, !!rpcError);
      } catch {
        settle(null, true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [key]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const current = result?.key === key ? result : null;
  return {
    age: current?.age ?? null,
    loading: !current,
    error: current?.error ?? false,
    retry,
  };
}

/**
 * Ages for a list of profile ids (host-side views). The database returns an
 * adult's age by their visibility setting, and a minor's only to the minor, a
 * verified guardian or a moderator; everyone else gets no row (null here).
 */
export async function fetchProfileAges(ids: string[]): Promise<Record<string, number | null>> {
  if (ids.length === 0) return {};
  try {
    const { data } = await (supabase.rpc as any)("profile_ages", { _ids: ids });
    const out: Record<string, number | null> = {};
    for (const row of (data ?? []) as { id: string; age: number | null }[]) {
      out[row.id] = row.age ?? null;
    }
    return out;
  } catch {
    return {};
  }
}
