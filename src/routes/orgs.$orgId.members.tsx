import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { RouteFallback, FALLBACK_ACTION_CLASS } from "@/components/layout/RouteFallback";
import { pageHead } from "@/lib/seo";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Search, UserMinus, UserPlus, Shield, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { UserAvatar } from "@/components/UserAvatar";
import {
  listOrgMembers,
  listOrgMemberRequests,
  approveOrgMemberRequest,
  denyOrgMemberRequest,
  setGenericOrgMemberRole,
  removeGenericOrgMember,
  searchProfilesForInvite,
  addOrgMemberDirect,
} from "@/lib/trainer-orgs.functions";

export const Route = createFileRoute("/orgs/$orgId/members")({
  head: () =>
    pageHead({
      title: "Manage gym members — ballaCity",
      description: "Review requests and manage members of your gym.",
      noindex: true,
    }),
  ssr: false,
  component: MembersPage,
  errorComponent: ({ error, reset }) => (
    <RouteFallback
      title="Couldn't load these members"
      message={error.message}
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

function MembersPage() {
  const { orgId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [checkedAdmin, setCheckedAdmin] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [orgName, setOrgName] = useState("");

  const setRole = useServerFn(setGenericOrgMemberRole);
  const removeMember = useServerFn(removeGenericOrgMember);
  const approve = useServerFn(approveOrgMemberRequest);
  const deny = useServerFn(denyOrgMemberRequest);
  const searchFn = useServerFn(searchProfilesForInvite);
  const addFn = useServerFn(addOrgMemberDirect);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (!uid) {
        setCheckedAdmin(true);
        return;
      }
      const [{ data: org }, { data: admin }] = await Promise.all([
        supabase.from("trainer_orgs").select("name,owner_id").eq("id", orgId).maybeSingle(),
        supabase.rpc("is_trainer_org_admin", { _org: orgId, _user: uid }),
      ]);
      setOrgName(org?.name ?? "");
      setIsAdmin(Boolean(admin));
      setCheckedAdmin(true);
    })();
  }, [orgId]);

  const membersQ = useQuery({
    queryKey: ["org-members", orgId],
    queryFn: () => listOrgMembers({ data: { orgId } }),
    enabled: isAdmin,
  });

  const requestsQ = useQuery({
    queryKey: ["org-member-requests", orgId],
    queryFn: () => listOrgMemberRequests({ data: { orgId } }),
    enabled: isAdmin,
  });

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const searchQ = useQuery({
    queryKey: ["org-invite-search", orgId, debouncedQ],
    queryFn: () => searchFn({ data: { orgId, q: debouncedQ } }),
    enabled: isAdmin && debouncedQ.length >= 2,
  });

  const memberIdSet = useMemo(
    () => new Set((membersQ.data ?? []).map((m) => m.user_id)),
    [membersQ.data],
  );

  if (!checkedAdmin) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!userId) {
    navigate({ to: "/auth" });
    return null;
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md p-8 text-center space-y-3">
        <Shield className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Only owners and admins can manage members.</p>
        <Link
          to="/orgs/$orgId"
          params={{ orgId }}
          className="inline-flex text-sm font-semibold text-lime hover:underline"
        >
          Back to gym
        </Link>
      </div>
    );
  }

  async function onSetRole(uid: string, role: "admin" | "member") {
    try {
      await setRole({ data: { orgId, userId: uid, role } });
      qc.invalidateQueries({ queryKey: ["org-members", orgId] });
      toast.success(`Set to ${role}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  async function onRemove(uid: string, name: string) {
    if (!confirm(`Remove ${name}?`)) return;
    try {
      await removeMember({ data: { orgId, userId: uid } });
      qc.invalidateQueries({ queryKey: ["org-members", orgId] });
      toast.success("Removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  async function onApprove(id: string) {
    try {
      await approve({ data: { id } });
      qc.invalidateQueries({ queryKey: ["org-member-requests", orgId] });
      qc.invalidateQueries({ queryKey: ["org-members", orgId] });
      toast.success("Approved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  async function onDeny(id: string) {
    const reason = prompt("Reason (optional)") ?? "";
    try {
      await deny({ data: { id, reason } });
      qc.invalidateQueries({ queryKey: ["org-member-requests", orgId] });
      toast.success("Denied");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  async function onInvite(uid: string, role: "admin" | "member") {
    try {
      await addFn({ data: { orgId, userId: uid, role } });
      qc.invalidateQueries({ queryKey: ["org-members", orgId] });
      qc.invalidateQueries({ queryKey: ["org-invite-search", orgId, debouncedQ] });
      toast.success("Added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="mx-auto w-full max-w-md sm:max-w-2xl p-4 pb-24 space-y-5">
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
        <h1 className="font-display text-3xl font-bold">Manage members.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {orgName ? `${orgName} · ` : ""}Invite people, review requests, and set roles.
        </p>
      </header>

      {/* Invite */}
      <section className="rounded-2xl border border-border bg-surface p-4 space-y-3">
        <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
          Invite people
        </h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by display name…"
            className="w-full rounded-xl border border-border bg-background pl-9 pr-3 py-2 text-sm"
          />
        </div>
        {debouncedQ.length < 2 ? (
          <p className="text-[11px] text-muted-foreground">Type at least 2 characters.</p>
        ) : searchQ.isLoading ? (
          <div className="text-xs text-muted-foreground">Searching…</div>
        ) : (searchQ.data ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">No matches.</div>
        ) : (
          <ul className="space-y-2">
            {(searchQ.data ?? []).map((p) => {
              const already = memberIdSet.has(p.id);
              return (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background p-2"
                >
                  <UserAvatar
                    avatarUrl={p.avatar_url}
                    initials={p.avatar_initials}
                    name={p.display_name}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {p.display_name || "Unnamed"}
                    </div>
                    {already && (
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Already a member
                      </div>
                    )}
                  </div>
                  {!already && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onInvite(p.id, "member")}
                        className="inline-flex items-center gap-1 rounded-lg bg-lime px-2.5 py-1.5 text-xs font-bold text-primary-foreground"
                      >
                        <UserPlus className="h-3.5 w-3.5" /> Add
                      </button>
                      <button
                        type="button"
                        onClick={() => onInvite(p.id, "admin")}
                        className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold"
                      >
                        As admin
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Pending requests */}
      <section className="rounded-2xl border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
            Pending requests
          </h2>
          <span className="text-[11px] text-muted-foreground">{(requestsQ.data ?? []).length}</span>
        </div>
        {requestsQ.isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (requestsQ.data ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">No pending requests.</div>
        ) : (
          <ul className="space-y-2">
            {(requestsQ.data ?? []).map((r) => {
              const name = r.profile?.display_name || "Someone";
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background p-2"
                >
                  <UserAvatar
                    avatarUrl={r.profile?.avatar_url}
                    initials={r.profile?.avatar_initials}
                    name={name}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{name}</div>
                    {r.message && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        “{r.message}”
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onApprove(r.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-lime px-2.5 py-1.5 text-xs font-bold text-primary-foreground"
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeny(r.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-coral/40 bg-coral/10 px-2.5 py-1.5 text-xs font-semibold text-coral"
                    >
                      <X className="h-3.5 w-3.5" /> Deny
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Members */}
      <section className="rounded-2xl border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
            Members
          </h2>
          <span className="text-[11px] text-muted-foreground">{(membersQ.data ?? []).length}</span>
        </div>
        {membersQ.isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (membersQ.data ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">No members yet.</div>
        ) : (
          <ul className="space-y-2">
            {(membersQ.data ?? []).map((m) => {
              const name = m.profile?.display_name || "Member";
              const roleValue = m.role === "admin" ? "admin" : "member";
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background p-2"
                >
                  <UserAvatar
                    avatarUrl={m.profile?.avatar_url}
                    initials={m.profile?.avatar_initials}
                    name={name}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{name}</div>
                    <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                      {m.role === "admin" && <Shield className="h-3 w-3 text-lime" />}
                      {m.role}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <select
                      value={roleValue}
                      onChange={(e) => onSetRole(m.user_id, e.target.value as "admin" | "member")}
                      className="rounded-lg border border-border bg-surface px-2 py-1 text-xs"
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => onRemove(m.user_id, name)}
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
