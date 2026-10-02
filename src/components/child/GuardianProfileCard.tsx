import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Phone, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Reads the signed-in adult's account type straight from their own profile row. */
/**
 * Parents are stored with account_type "player" (the database allows only four
 * types), so a guardian is recognised by what they did: chose Parent / Guardian
 * at sign-up, or manage / are linked to at least one child.
 */
export function useIsGuardianAccount() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["is-guardian-account", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const meta = (user!.user_metadata ?? {}) as Record<string, unknown>;
      if (meta["is_guardian"] === true) return true;
      const [{ data: p }, { count: managed }, { count: linked }] = await Promise.all([
        supabase.from("profiles").select("account_type").eq("id", user!.id).maybeSingle(),
        supabase
          .from("managed_accounts")
          .select("child_user_id", { count: "exact", head: true })
          .eq("managed_by", user!.id),
        supabase
          .from("guardian_links")
          .select("id", { count: "exact", head: true })
          .eq("parent_user_id", user!.id)
          .neq("status", "revoked"),
      ]);
      return (p?.account_type as string | null) === "parent" || (managed ?? 0) > 0 || (linked ?? 0) > 0;
    },
  });
  return { isGuardian: q.data === true, loading: !!user && q.isLoading };
}

/** Guardian identity + private emergency contact, shown in the Parent Center. */
export function GuardianProfileCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const profile = useQuery({
    queryKey: ["guardian-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [{ data: p }, { data: ec }] = await Promise.all([
        supabase.from("profiles").select("display_name, avatar_url").eq("id", user!.id).maybeSingle(),
        supabase.rpc("get_my_emergency_contact"),
      ]);
      const row = Array.isArray(ec) ? ec[0] : ec;
      return {
        name: p?.display_name ?? "",
        avatar: p?.avatar_url ?? null,
        contactName: row?.contact_name ?? "",
        contactPhone: row?.contact_phone ?? "",
        relationship: row?.relationship ?? "",
      };
    },
  });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ contactName: "", contactPhone: "", relationship: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile.data) {
      const { contactName, contactPhone, relationship } = profile.data;
      setForm({ contactName, contactPhone, relationship });
    }
  }, [profile.data]);

  if (!user) return null;
  const d = profile.data;
  const hasContact = !!(d?.contactName || d?.contactPhone);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        emergency_contact_name: form.contactName.trim() || null,
        emergency_contact_phone: form.contactPhone.trim() || null,
        emergency_contact_relationship: form.relationship.trim() || null,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast.error("Couldn't save your emergency contact. Please try again.");
      return;
    }
    toast.success("Emergency contact saved");
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["guardian-profile", user.id] });
  };

  return (
    <section className="mt-5 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        {d?.avatar ? (
          <img src={d.avatar} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" aria-hidden />
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate font-semibold">{d?.name || user.email}</div>
          <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            <ShieldCheck className="h-3 w-3" aria-hidden /> Parent / Guardian
          </span>
        </div>
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Phone className="h-4 w-4" aria-hidden /> Emergency contact
          </div>
          {!editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {hasContact ? "Edit" : "Add"}
            </Button>
          )}
        </div>
        {editing ? (
          <div className="mt-2 grid gap-2">
            <Input
              placeholder="Name"
              value={form.contactName}
              onChange={(e) => setForm({ ...form, contactName: e.target.value })}
            />
            <Input
              placeholder="Phone"
              type="tel"
              value={form.contactPhone}
              onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
            />
            <Input
              placeholder="Relationship (e.g. spouse, grandparent)"
              value={form.relationship}
              onChange={(e) => setForm({ ...form, relationship: e.target.value })}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : hasContact ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {d?.contactName}
            {d?.relationship ? ` (${d.relationship})` : ""}
            {d?.contactPhone ? ` · ${d.contactPhone}` : ""}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Add someone coaches can reach if you can't be contacted. Only you can see this.
          </p>
        )}
      </div>
    </section>
  );
}
