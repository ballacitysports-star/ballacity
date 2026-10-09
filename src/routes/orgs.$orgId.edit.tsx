import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { RouteFallback, FALLBACK_ACTION_CLASS } from "@/components/layout/RouteFallback";
import { pageHead } from "@/lib/seo";
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
import { parseHours } from "@/lib/org-hours";
import { websiteHref } from "@/lib/org-listing";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveStatus } from "@/components/SaveStatus";

export const Route = createFileRoute("/orgs/$orgId/edit")({
  head: () =>
    pageHead({
      title: "Edit gym — BallaCity",
      description: "Update your gym's details, hours, amenities, and photos.",
      noindex: true,
    }),
  ssr: false,
  component: EditOrg,
  errorComponent: ({ error, reset }) => (
    <RouteFallback
      title="Couldn't open this gym for editing"
      message={error instanceof Error ? error.message : "Something went wrong."}
      onRetry={reset}
      action={
        <Link to="/orgs" className={FALLBACK_ACTION_CLASS}>
          Back to gyms
        </Link>
      }
    />
  ),
  notFoundComponent: () => (
    <RouteFallback
      title="Gym not found"
      message="It may have been removed, or the link may be wrong."
      action={
        <Link to="/orgs" className={FALLBACK_ACTION_CLASS}>
          Back to gyms
        </Link>
      }
    />
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
      const row = orgQ.data as typeof orgQ.data & {
        phone?: string | null;
        email?: string | null;
        category?: string | null;
        amenities?: string[] | null;
        photos?: string[] | null;
        hours?: unknown;
        timezone?: string | null;
        booking_url?: string | null;
      };
      const geo = orgQ.data.geo as { lat?: number; lng?: number } | null;
      setValue({
        name: orgQ.data.name ?? "",
        handle: orgQ.data.handle ?? "",
        city: orgQ.data.city ?? "",
        bio: orgQ.data.bio ?? "",
        website: orgQ.data.website ?? "",
        bookingUrl: row.booking_url ?? "",
        address: orgQ.data.address ?? "",
        placeId: orgQ.data.place_id ?? "",
        geo: geo?.lat && geo?.lng ? { lat: geo.lat, lng: geo.lng } : null,
        avatarUrl: orgQ.data.avatar_url ?? "",
        coverUrl: orgQ.data.cover_url ?? "",
        phone: row.phone ?? "",
        email: row.email ?? "",
        category: row.category ?? "",
        amenities: row.amenities ?? [],
        photos: row.photos ?? [],
        hours: parseHours(row.hours),
        timezone: row.timezone ?? "",
      });
    }
  }, [orgQ.data, value]);

  const isOwner = !!userId && orgQ.data?.owner_id === userId;
  const isAdmin =
    isOwner ||
    !!membersQ.data?.some(
      (m) => m.user_id === userId && (m.role === "owner" || m.role === "admin"),
    );

  const persist = async (v: OrgFormValue | null) => {
    if (!v) return;
    await update({
      data: {
        id: orgId,
        name: v.name.trim(),
        handle: v.handle.trim().toLowerCase(),
        bio: v.bio.trim() || null,
        city: v.city.trim() || null,
        website: websiteHref(v.website) ?? (v.website.trim() || null),
        bookingUrl: websiteHref(v.bookingUrl) ?? (v.bookingUrl.trim() || null),
        address: v.address.trim() || null,
        placeId: v.placeId || null,
        geo: v.geo,
        avatarUrl: v.avatarUrl || null,
        coverUrl: v.coverUrl || null,
        phone: v.phone.trim() || null,
        email: v.email.trim() || null,
        category: v.category || null,
        amenities: v.amenities,
        photos: v.photos,
        hours: v.hours,
        timezone: v.timezone || null,
      },
    });
    qc.invalidateQueries({ queryKey: ["org-edit", orgId] });
  };

  const autosave = useAutosave<OrgFormValue | null>({
    value,
    enabled: !!value && isAdmin,
    validate: (v) => {
      if (!v) return null;
      if (!v.name.trim()) return "name is required";
      if (!v.handle.trim()) return "handle is required";
      return null;
    },
    save: persist,
  });

  if (orgQ.isLoading || !value) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }
  if (orgQ.error) {
    return <div className="p-8 text-sm text-coral">{(orgQ.error as Error).message}</div>;
  }
  if (!isAdmin) {
    return (
      <div className="page-shell-narrow py-8 text-center space-y-3">
        <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Only owners and admins can edit this gym.</p>
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
    setSaving(true);
    try {
      await autosave.flush();
      navigate({ to: "/orgs/$orgId", params: { orgId } });
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
    <div className="page-shell pt-4 pb-40 space-y-4">
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
        <h1 className="page-title">Edit gym.</h1>
        <p className="mt-1 page-subtitle">Update details, branding, and members.</p>
        <SaveStatus {...autosave} className="mt-2" />
      </header>

      <OrgForm
        value={value}
        onChange={setValue}
        userId={userId}
        submitting={saving}
        onSubmit={onSubmit}
        onDelete={isOwner ? onDelete : undefined}
        submitLabel="Done"
      />

      <section className="rounded-2xl border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
            Trainer members
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {(membersQ.data ?? []).length} total
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Trainers linked to this gym. Owners can promote to admin, demote to member, or transfer
          ownership.
        </p>
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
                  <div className="flex items-center gap-1 micro-label text-muted-foreground">
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

      <section className="rounded-2xl border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
            People
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {(genericMembersQ.data ?? []).length} total
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Members who joined this gym through a request to join. Change their role or remove them.
        </p>
        {genericMembersQ.isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (genericMembersQ.data ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">No members yet.</div>
        ) : (
          <ul className="space-y-2">
            {(genericMembersQ.data ?? []).map((m) => {
              const name = m.profile?.display_name || "Member";
              const initials = m.profile?.avatar_initials || name.slice(0, 2).toUpperCase();
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background p-2"
                >
                  <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-lime-gradient text-xs font-bold text-primary-foreground">
                    {m.profile?.avatar_url ? (
                      <img
                        src={m.profile.avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      initials
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{name}</div>
                    <div className="flex items-center gap-1 micro-label text-muted-foreground">
                      {m.role === "admin" && <Shield className="h-3 w-3 text-lime" />}
                      {m.role}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <select
                      value={m.role === "admin" ? "admin" : "member"}
                      onChange={async (e) => {
                        const role = e.target.value as "admin" | "member";
                        try {
                          await setGenericRole({
                            data: { orgId, userId: m.user_id, role },
                          });
                          qc.invalidateQueries({
                            queryKey: ["org-edit-generic-members", orgId],
                          });
                          toast.success(`Set to ${role}`);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Failed");
                        }
                      }}
                      className="rounded-lg border border-border bg-surface px-2 py-1 text-xs"
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm(`Remove ${name} from this gym?`)) return;
                        try {
                          await removeGeneric({
                            data: { orgId, userId: m.user_id },
                          });
                          qc.invalidateQueries({
                            queryKey: ["org-edit-generic-members", orgId],
                          });
                          toast.success("Removed");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Failed");
                        }
                      }}
                      className="rounded-lg border border-coral/40 bg-coral/10 p-1.5 text-coral"
                      aria-label="Remove"
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
