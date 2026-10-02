import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type EmergencyContact = {
  name: string;
  phone: string;
  relationship: string;
};

const EMPTY: EmergencyContact = { name: "", phone: "", relationship: "" };

/**
 * Reads and updates the signed-in guardian's own emergency contact.
 * Self-contained (own fetch + own update) rather than threaded through
 * profile.edit.tsx's generic autosave pipeline, the same shape as
 * avatar-privacy.ts's useAvatarVisibility — these columns are private
 * (see 20261001150000_guardian_emergency_contact.sql), so reading them back
 * goes through get_my_emergency_contact(), never a plain .select().
 */
export function useMyEmergencyContact() {
  const [value, setValue] = useState<EmergencyContact>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        if (!cancelled) setLoading(false);
        return;
      }
      // Not yet in the generated Database type until the migration ships live
      // and Lovable regenerates it (same transient gap get_my_birthday itself
      // once had — see src/lib/use-my-age.ts).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.rpc as any)("get_my_emergency_contact");
      const row = (Array.isArray(data) ? data[0] : data) as
        | { contact_name: string | null; contact_phone: string | null; relationship: string | null }
        | null
        | undefined;
      if (cancelled) return;
      setValue({
        name: row?.contact_name ?? "",
        phone: row?.contact_phone ?? "",
        relationship: row?.relationship ?? "",
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: EmergencyContact) => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new Error("Sign in to save your emergency contact");
    setSaving(true);
    try {
      // Same transient gap as above: these columns aren't in the generated
      // Update type yet either.
      const patch = {
        emergency_contact_name: next.name.trim().slice(0, 100) || null,
        emergency_contact_phone: next.phone.trim().slice(0, 40) || null,
        emergency_contact_relationship: next.relationship.trim().slice(0, 60) || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      const { error } = await supabase.from("profiles").update(patch).eq("id", auth.user.id);
      if (error) throw error;
      setValue(next);
    } finally {
      setSaving(false);
    }
  }, []);

  return { value, loading, saving, save };
}
