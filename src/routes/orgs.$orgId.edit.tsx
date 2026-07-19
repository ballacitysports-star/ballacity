import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ShieldCheck, Trash2, UserMinus, Crown, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  updateTrainerOrg,
  deleteTrainerOrg,
  setOrgMemberRole,
  removeOrgMember,
  listOrgMembers,
  setGenericOrgMemberRole,
  removeGenericOrgMember,
} from "@/lib/trainer-orgs.functions";
import { OrgForm, type OrgFormValue } from "@/components/OrgForm";

export const Route = createFileRoute("/orgs/$orgId/edit")({
  ssr: false,
  head: () => ({ meta: [{ title: "Edit gym — OpenRun" }] }),
  component: EditOrg,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-coral">{error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="p-8 text-sm text-muted-foreground">Organization not found.</div>
  ),
});

type Member = {
  id: string;
  trainer_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  trainer_name: string | null;
  trainer_avatar: string | null;
};

function EditOrg() {
  const { orgId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [value, setValue] = useState<OrgFormValue | null>(null);
  const [saving, setSaving] = useState(false);
  const update = useServerFn(updateTrainerOrg);
  const del = useServerFn(deleteTrainerOrg);
  const setRole = useServerFn(setOrgMemberRole);
  const remove = useServerFn(removeOrgMember);
  const setGenericRole = useServerFn(setGenericOrgMemberRole);
  const removeGeneric = useServerFn(removeGenericOrgMember);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const orgQ = useQuery({
    queryKey: ["org-edit", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trainer_orgs")
        .select("*")
        .eq("id", orgId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Not found");
      return data;
    },
  });

  const membersQ = useQuery({
    queryKey: ["org-edit-members", orgId],
    queryFn: async (): Promise<Member[]> => {
      const { data, error } = await supabase
        .from("trainer_org_members")
        .select("id, trainer_id, user_id, role, teams:trainer_id(name, avatar)")
        .eq("org_id", orgId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => {
        const t = r.teams as { name?: string | null; avatar?: string | null } | null;
        return {
          id: r.id,
          trainer_id: r.trainer_id,
          user_id: r.user_id,
          role: r.role as Member["role"],
          trainer_name: t?.name ?? null,
          trainer_avatar: t?.avatar ?? null,
        };
      });
    },
  });

  const genericMembersQ = useQuery({
    queryKey: ["org-edit-generic-members", orgId],
    queryFn: () => listOrgMembers({ data: { orgId } }),
  });

  useEffect(() => {
    if (orgQ.data && !value) {
      const geo = orgQ.data.geo as { lat?: number; lng?: number } | null;
      setValue({
        name: orgQ.data.name ?? "",
        handle: orgQ.data.handle ?? "",
        city: orgQ.data.city ?? "",
        bio: orgQ.data.bio ?? "",
        website: orgQ.data.website ?? "",
        address: orgQ.data.address ?? "",
        placeId: orgQ.data.place_id ?? "",
        geo: geo?.lat && geo?.lng ? { lat: geo.lat, lng: geo.lng } : null,
        avatarUrl: orgQ.data.avatar_url ?? "",
        coverUrl: orgQ.data.cover_url ?? "",
      });
    }
  }, [orgQ.data, value]);

  const isOwner = !!userId && orgQ.data?.owner_id === userId;
  const isAdmin =
    isOwner ||
    !!membersQ.data?.some(
      (m) => m.user_id === userId && (m.role === "owner" || m.role === "admin"),
    );

  if (orgQ.isLoading || !value) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }
  if (orgQ.error) {
    return <div className="p-8 text-sm text-coral">{(orgQ.error as Error).message}</div>;
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md p-8 text-center space-y-3">
        <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Only owners and admins can edit this gym.
        </p>
        <Link
          to="/orgs/$orgId"
          params={{ orgId }}
          className="inline-flex text-sm font-semibold text-lime hover:underline"
        >
          Back to profile
        </Link>
      </div>
    );
  }

  async function onSubmit() {
    if (!value) return;
    setSaving(true);
    try {
      await update({
        data: {
          id: orgId,
          name: value.name.trim(),
          handle: value.handle.trim().toLowerCase(),
          bio: value.bio.trim() || null,
          city: value.city.trim() || null,
          website: value.website.trim() || null,
          address: value.address.trim() || null,
          placeId: value.placeId || null,
          geo: value.geo,
          avatarUrl: value.avatarUrl || null,
          coverUrl: value.coverUrl || null,
        },
      });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["org-edit", orgId] });
      navigate({ to: "/orgs/$orgId", params: { orgId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!isOwner) {
      toast.error("Only the owner can delete this gym.");
      return;
    }
    if (!confirm("Delete this gym? This cannot be undone.")) return;
    try {
      await del({ data: { id: orgId } });
      toast.success("Deleted");
      navigate({ to: "/orgs" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  return (
    <div className="mx-auto w-full max-w-md sm:max-w-2xl p-4 pb-40 space-y-4">
      <div className="flex items-center gap-2">
        <Link
          to="/orgs/$orgId"
          params={{ orgId }}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
      </div>

      <header>
        <h1 className="font-display text-3xl font-bold">Edit gym.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Update details, branding, and members.
        </p>
      </header>

      <OrgForm
        value={value}
        onChange={setValue}
        userId={userId}
        submitting={saving}
        onSubmit={onSubmit}
        onDelete={isOwner ? onDelete : undefined}
        submitLabel="Save changes"
      />

      <section className="rounded-2xl border border-border bg-surface p-4 space-y-3">
        <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
          Members
        </h2>
        {membersQ.isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (membersQ.data ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">No members yet.</div>
        ) : (
          <ul className="space-y-2">
            {(membersQ.data ?? []).map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-background p-2"
              >
                <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-lime-gradient text-xs font-bold text-primary-foreground">
                  {m.trainer_avatar &&
                  (m.trainer_avatar.startsWith("http") || m.trainer_avatar.startsWith("/")) ? (
                    <img src={m.trainer_avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    (m.trainer_avatar || m.trainer_name || "?").slice(0, 2).toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {m.trainer_name || "Unnamed trainer"}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                    {m.role === "owner" && <Crown className="h-3 w-3 text-lime" />}
                    {m.role === "admin" && <Shield className="h-3 w-3 text-lime" />}
                    {m.role}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <select
                    value={m.role}
                    disabled={m.role === "owner" && !isOwner}
                    onChange={async (e) => {
                      const role = e.target.value as Member["role"];
                      try {
                        await setRole({ data: { orgId, trainerId: m.trainer_id, role } });
                        qc.invalidateQueries({ queryKey: ["org-edit-members", orgId] });
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Failed");
                      }
                    }}
                    className="rounded-lg border border-border bg-surface px-2 py-1 text-xs"
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                    {isOwner && <option value="owner">owner</option>}
                  </select>
                  {m.role !== "owner" && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm(`Remove ${m.trainer_name || "this member"}?`)) return;
                        try {
                          await remove({ data: { orgId, trainerId: m.trainer_id } });
                          qc.invalidateQueries({ queryKey: ["org-edit-members", orgId] });
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Failed");
                        }
                      }}
                      className="rounded-lg border border-coral/40 bg-coral/10 p-1.5 text-coral"
                      aria-label="Remove"
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {isOwner && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Trash2 className="h-3 w-3" /> Owner-only actions like transferring ownership and
            deleting the gym are above.
          </p>
        )}
      </section>
    </div>
  );
}
