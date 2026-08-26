import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
 */
export function useMyAge(): { age: number | null; loading: boolean } {
  const [age, setAge] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) {
          if (!cancelled) {
            setAge(null);
            setLoading(false);
          }
          return;
        }
        const { data } = await (supabase.rpc as any)("get_my_birthday");
        const iso = typeof data === "string" ? data : null;
        if (!cancelled) {
          setAge(iso ? ageFromBirthday(iso) : null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setAge(null);
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { age, loading };
}

/** Ages for a list of profile ids (host-side views). */
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
