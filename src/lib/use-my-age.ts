import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserId } from "@/lib/current-user-id";

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
 */
export function useMyAge(): {
  age: number | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
} {
  const [age, setAge] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (!(await getCurrentUserId())) {
          if (!cancelled) {
            setAge(null);
            setError(false);
            setLoading(false);
          }
          return;
        }
        const { data, error: rpcError } = await (supabase.rpc as any)("get_my_birthday");
        const iso = typeof data === "string" ? data : null;
        if (!cancelled) {
          setAge(iso ? ageFromBirthday(iso) : null);
          setError(!!rpcError);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setAge(null);
          setError(true);
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(false);
    setAttempt((n) => n + 1);
  }, []);

  return { age, loading, error, retry };
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
