import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Building2, MapPin, Users, ShieldCheck, Check, X, LogIn, UserPlus, Clock, Crown, UserMinus } from "lucide-react";
import { VenueMapPreview } from "@/components/VenueMapPreview";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  getTrainerOrg,
  listJoinRequestsForOrg,
  reviewJoinRequest,
  listMyTrainerProfiles,
  getMyJoinRequestsForOrg,
  listInvitesForTrainer,
  requestToJoinTrainerOrg,
  respondToTrainerOrgInvite,
  leaveTrainerOrg,
  listOrgMembers,
  requestOrgMembership,
  withdrawOrgMemberRequest,
  getMyOrgMemberRequest,
  listOrgMemberRequests,
  approveOrgMemberRequest,
  denyOrgMemberRequest,
  removeGenericOrgMember,
  leaveOrgMembership,
} from "@/lib/trainer-orgs.functions";

export const Route = createFileRoute("/orgs/$orgId")({
  head: ({ loaderData }) => {
    const o = (loaderData as Awaited<ReturnType<typeof getTrainerOrg>> | undefined) ?? null;
    if (!o?.org) {
      return { meta: [{ title: "Organization — OpenRun" }, { name: "robots", content: "noindex" }] };
    }
    return {
      meta: [
        { title: `${o.org.name} — Trainer organization on OpenRun` },
        { name: "description", content: (o.org.bio || `${o.org.name} on OpenRun.`).slice(0, 155) },
      ],
    };
  },
  loader: async ({ params }) => {
    const res = await getTrainerOrg({ data: { id: params.orgId } });
    if (!res) throw notFound();
    return res;
  },
  component: OrgPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-muted-foreground">Failed to load: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm text-muted-foreground">Organization not found.</div>,
});

function OrgPage() {
  const initial = Route.useLoaderData();
  const { orgId } = Route.useParams();
  const auth = useAuth();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["trainer-org", orgId],
    queryFn: () => getTrainerOrg({ data: { id: orgId } }),
    initialData: initial,
  });

  const org = data?.org;
  const members = (data?.members ?? []) as Array<{
    id: string;
    trainer_id: string;
    user_id: string;
    role: string;
    teams?: { id: string; name: string; handle: string; avatar: string | null; city: string | null; sports: string[] | null } | null;
  }>;
  const myMembership = auth.user ? members.find((m) => m.user_id === auth.user!.id) : null;
  const isOwner = !!auth.user && !!org && org.owner_id === auth.user.id;
  const isAdmin =
    isOwner || (!!myMembership && (myMembership.role === "owner" || myMembership.role === "admin"));

  const requests = useQuery({
    queryKey: ["trainer-org-requests", orgId],
    queryFn: () => listJoinRequestsForOrg({ data: { orgId } }),
    enabled: isAdmin,
  });

  if (!org) return null;

  async function review(id: string, action: "approve" | "reject") {
    try {
      await reviewJoinRequest({ data: { id, action } });
      toast.success(action === "approve" ? "Approved" : "Rejected");
      qc.invalidateQueries({ queryKey: ["trainer-org-requests", orgId] });
      qc.invalidateQueries({ queryKey: ["trainer-org", orgId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl p-4 pb-40 space-y-6">
      <header className="rounded-2xl border border-border/60 bg-surface p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-lime/15 text-2xl">
            {org.avatar || <Building2 className="h-6 w-6 text-lime" />}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-bold flex items-center gap-2 flex-wrap">
              {org.name}
              {org.verified && (
                <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime">
                  <ShieldCheck className="h-3 w-3" /> Verified
                </span>
              )}
              {isAdmin && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">
                  <Crown className="h-3 w-3" /> {isOwner ? "Owner" : "Admin"}
                </span>
              )}
            </h1>
            <div className="mt-1 text-sm text-muted-foreground flex flex-wrap items-center gap-2">
              <span>@{org.handle}</span>
              {org.city && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {org.city}
                  </span>
                </>
              )}
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> {members.length} trainer{members.length === 1 ? "" : "s"}
              </span>
            </div>
            {org.bio && <p className="mt-3 text-sm text-foreground/90 whitespace-pre-wrap">{org.bio}</p>}
            {(org as { address?: string | null }).address && (
              <div className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> {(org as { address?: string }).address}
              </div>
            )}
            {(() => {
              const geo = (org as { geo?: { lat?: number; lng?: number } | null }).geo;
              if (!geo || typeof geo.lat !== "number" || typeof geo.lng !== "number") return null;
              const address = (org as { address?: string | null }).address ?? org.name;
              const placeId = (org as { place_id?: string | null }).place_id ?? undefined;
              return (
                <div className="mt-3 overflow-hidden rounded-2xl border border-border">
                  <VenueMapPreview address={address} lat={geo.lat} lng={geo.lng} placeId={placeId ?? undefined} />
                </div>
              );
            })()}
            {org.website && (
              <a
                href={org.website}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-lime hover:underline"
              >
                {org.website}
              </a>
            )}

            <div className="mt-4">
              <MembershipCta orgId={orgId} members={members} />
            </div>
          </div>
          {isAdmin && (
            <Link
              to="/orgs/$orgId/edit"
              params={{ orgId }}
              className="shrink-0 rounded-full border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-bold text-lime hover:bg-lime/20"
            >
              Edit
            </Link>
          )}
        </div>
      </header>

      <section className="rounded-2xl border border-border/60 bg-surface p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-lime" /> Trainers
        </h2>
        {members.length === 0 ? (
          <p className="text-xs text-muted-foreground">No trainers yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {members.map((m) => {
              const t = m.teams;
              if (!t) return null;
              return (
                <li key={m.id}>
                  <Link
                    to="/trainers/$trainerId"
                    params={{ trainerId: t.id }}
                    className="flex items-center gap-3 rounded-xl border border-border/50 bg-background px-3 py-2 hover:border-lime/60"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-lime/15 text-sm">
                      {t.avatar || "T"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{t.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {m.role}
                        {t.city ? ` · ${t.city}` : ""}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {isAdmin && (
        <section className="rounded-2xl border border-border/60 bg-surface p-4">
          <h2 className="text-sm font-semibold mb-3">Pending join requests</h2>
          {(requests.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No pending requests.</p>
          ) : (
            <ul className="space-y-2">
              {requests.data!.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-border/50 bg-background px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{r.trainer?.name ?? r.trainer_id}</div>
                    {r.message && (
                      <div className="text-[11px] text-muted-foreground truncate">{r.message}</div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" onClick={() => review(r.id, "approve")}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => review(r.id, "reject")}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function MembershipCta({
  orgId,
  members,
}: {
  orgId: string;
  members: Array<{ trainer_id: string; user_id: string; role: string }>;
}) {
  const auth = useAuth();
  const qc = useQueryClient();
  const signedIn = !!auth.user;

  const myTrainers = useQuery({
    queryKey: ["my-trainer-profiles"],
    queryFn: () => listMyTrainerProfiles(),
    enabled: signedIn,
  });
  const myRequests = useQuery({
    queryKey: ["my-org-join-requests", orgId],
    queryFn: () => getMyJoinRequestsForOrg({ data: { orgId } }),
    enabled: signedIn,
  });

  const owned = myTrainers.data ?? [];
  const ownedIds = new Set(owned.map((t) => t.id));

  const myMember = signedIn
    ? members.find((m) => m.user_id === auth.user!.id && ownedIds.has(m.trainer_id))
    : undefined;

  const invites = useQuery({
    queryKey: ["my-invites-for-org", orgId, owned.map((t) => t.id).join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        owned.map((t) => listInvitesForTrainer({ data: { trainerId: t.id } })),
      );
      return results.flat().filter((inv) => inv.org_id === orgId);
    },
    enabled: signedIn && owned.length > 0 && !myMember,
  });

  if (!signedIn) {
    return (
      <Link
        to="/auth"
        search={{ next: `/orgs/${orgId}` }}
        className="inline-flex items-center gap-1.5 rounded-full bg-lime px-4 py-1.5 text-xs font-bold text-background hover:opacity-90"
      >
        <LogIn className="h-3.5 w-3.5" /> Sign in to join
      </Link>
    );
  }

  if (myTrainers.isLoading) {
    return <div className="text-xs text-muted-foreground">Loading…</div>;
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["trainer-org", orgId] });
    qc.invalidateQueries({ queryKey: ["my-org-join-requests", orgId] });
    qc.invalidateQueries({ queryKey: ["my-invites-for-org", orgId] });
  }

  // Already a member
  if (myMember) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-3 py-1 text-xs font-bold text-lime">
          <Check className="h-3 w-3" /> Member · {myMember.role}
        </span>
        {myMember.role !== "owner" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                await leaveTrainerOrg({ data: { orgId, trainerId: myMember.trainer_id } });
                toast.success("Left organization");
                invalidate();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              }
            }}
          >
            Leave
          </Button>
        )}
      </div>
    );
  }

  // No trainer profile
  if (owned.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        <Link to="/trainers/create" className="text-lime hover:underline font-semibold">
          Create a trainer profile
        </Link>{" "}
        to join this organization.
      </div>
    );
  }

  // Pending invite (respond)
  const pendingInvite = (invites.data ?? [])[0];
  if (pendingInvite) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Invited as {pendingInvite.role}</span>
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            try {
              await respondToTrainerOrgInvite({ data: { inviteId: pendingInvite.id, action: "accept" } });
              toast.success("Joined organization");
              invalidate();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed");
            }
          }}
        >
          <Check className="h-3.5 w-3.5 mr-1" /> Accept
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await respondToTrainerOrgInvite({ data: { inviteId: pendingInvite.id, action: "decline" } });
              invalidate();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed");
            }
          }}
        >
          Decline
        </Button>
      </div>
    );
  }

  // Pending join request
  const myPending = myRequests.data ?? [];
  if (myPending.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
        <Clock className="h-3 w-3" /> Requested — awaiting review
      </span>
    );
  }

  // Request to join
  return <RequestToJoin orgId={orgId} trainers={owned} onDone={invalidate} />;
}

function RequestToJoin({
  orgId,
  trainers,
  onDone,
}: {
  orgId: string;
  trainers: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState(trainers[0]?.id ?? "");

  async function submit() {
    if (!selected) return;
    setPending(true);
    try {
      await requestToJoinTrainerOrg({ data: { orgId, trainerId: selected } });
      toast.success("Join request sent");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(false);
    }
  }

  if (trainers.length > 1) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="h-9 rounded-lg border border-border/60 bg-background px-2 text-xs"
        >
          {trainers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <Button size="sm" disabled={pending} onClick={submit}>
          <UserPlus className="h-3.5 w-3.5 mr-1" /> Request to join
        </Button>
      </div>
    );
  }

  return (
    <Button size="sm" disabled={pending} onClick={submit}>
      <UserPlus className="h-3.5 w-3.5 mr-1" /> Request to join
    </Button>
  );
}
