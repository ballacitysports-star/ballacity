import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { BackButton } from "@/components/layout/BackButton";
import { RouteFallback, FALLBACK_ACTION_CLASS } from "@/components/layout/RouteFallback";
import { pageHead, ogImageUrl } from "@/lib/seo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  Building2,
  MapPin,
  Users,
  ShieldCheck,
  Check,
  X,
  LogIn,
  UserPlus,
  Clock,
  Crown,
  UserMinus,
} from "lucide-react";
import { VenueMapPreview } from "@/components/VenueMapPreview";
import { OrgListingHeader, type OrgListingRow } from "@/components/org/OrgListingHeader";
import { ClaimListingCard } from "@/components/listings/ClaimListingCard";
import { GymReviews } from "@/components/org/GymReviews";
import { buildFacilityJsonLd } from "@/lib/org-seo";
import { FacilityEventsSection } from "@/components/org/FacilityEventsSection";
import { CourtInquiriesSection } from "@/components/org/CourtInquiriesSection";
import { summarizeGymReviews, useGymReviews } from "@/lib/gym-reviews";

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
import { OrgAvatarMark } from "@/components/OrgAvatarMark";
import { ListingVisibilityToggle } from "@/components/listings/ListingVisibilityToggle";
import {
  getTrainerOrg,
  getTrainerOrgContact,
  getMyOrgAccess,
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

export const Route = createFileRoute("/orgs/$orgId/")({
  head: ({ loaderData, params }) => {
    const o = (loaderData as Awaited<ReturnType<typeof getTrainerOrg>> | undefined) ?? null;
    const org = o?.org;
    const name = org?.name ?? "Gym";
    return pageHead({
      path: `/orgs/${params.orgId}`,
      title: `${name} — ${org?.category || "Gym"} on BallaCity`,
      description: (
        org?.bio ||
        `${name}${org?.city ? ` in ${org.city}` : ""} on BallaCity: hours, amenities, upcoming runs, and how to book a court.`
      ).slice(0, 155),
      image: ogImageUrl({
        kind: "venue",
        title: name,
        subtitle: org?.city ?? org?.address ?? "Gym on BallaCity",
        meta: [org?.city, "Hours & amenities", "Member reviews"],
      }),
      noindex: !org,
      jsonLd: org ? buildFacilityJsonLd({ ...org, id: params.orgId }) : undefined,
    });
  },
  loader: async ({ params }) => {
    const res = await getTrainerOrg({ data: { id: params.orgId } });
    if (!res) throw notFound();
    return res;
  },
  component: OrgPage,
  errorComponent: ({ error, reset }) => (
    <RouteFallback
      title="Couldn't load this gym"
      message={error instanceof Error ? error.message : "Something went wrong."}
      error={error}
      onRetry={reset}
      action={
        <Link to="/orgs" className={FALLBACK_ACTION_CLASS}>
          Back to venues
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

  // Phone/email are not readable by signed-out visitors, so they load
  // separately once we know there's a session.
  const contact = useQuery({
    queryKey: ["trainer-org-contact", orgId],
    queryFn: () => getTrainerOrgContact({ data: { id: orgId } }),
    enabled: !!auth.user,
  });

  const org = data?.org;
  const orgWithContact = org
    ? { ...org, phone: contact.data?.phone ?? null, email: contact.data?.email ?? null }
    : null;
  const members = (data?.members ?? []) as Array<{
    id: string;
    trainer_id: string;
    role: string;
    teams?: {
      id: string;
      name: string;
      handle: string;
      avatar: string | null;
      city: string | null;
      sports: string[] | null;
    } | null;
  }>;
  // The public roster carries no user ids, so the viewer's own standing comes
  // from a signed-in lookup (owner/admin by role or ownership).
  const access = useQuery({
    queryKey: ["my-org-access", orgId, auth.user?.id ?? "anon"],
    queryFn: () => getMyOrgAccess({ data: { orgId } }),
    enabled: !!auth.user,
  });
  const isOwner = !!auth.user && !!access.data?.isOwner;
  const isAdmin = isOwner || !!access.data?.isAdmin;

  const gymReviews = useGymReviews(orgId);
  const reviewSummary = summarizeGymReviews(gymReviews.data ?? []);

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
    <div className="page-shell-content pt-4 pb-40 space-y-6">
      <BackButton fallbackTo="/orgs" variant="overlay" />
      <OrgListingHeader
        org={(orgWithContact ?? org) as unknown as OrgListingRow}
        memberCount={members.length}
        isAdmin={isAdmin}
        isOwner={isOwner}
        rating={reviewSummary.count ? reviewSummary.avg : null}
        reviewCount={reviewSummary.count}
      >
        <div className="flex flex-col gap-2">
          <MembershipCta orgId={orgId} members={members} />
          <MemberJoinCta orgId={orgId} />
        </div>
      </OrgListingHeader>

      {!!auth.user && access.data?.unclaimed && (
        <ClaimListingCard subjectType="gym" subjectId={orgId} name={org.name} />
      )}

      {isAdmin && <ListingVisibilityToggle kind="gym" id={orgId} />}

      <FacilityEventsSection orgId={orgId} canPost={isAdmin} />

      {isAdmin && <CourtInquiriesSection orgId={orgId} />}

      <div id="gym-reviews">
        <GymReviews orgId={orgId} orgName={org.name} isAdmin={isAdmin} />
      </div>

      <section className="rounded-2xl border border-border/60 bg-surface p-4">
        <h2 className="section-title mb-3 flex items-center gap-2">
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
                    <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-lime/15 text-sm">
                      <OrgAvatarMark avatar={t.avatar} fallback="T" />
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

      <MembersSection orgId={orgId} isAdmin={isAdmin} />

      {isAdmin && <AdminMemberRequests orgId={orgId} />}

      {isAdmin && (
        <section className="rounded-2xl border border-border/60 bg-surface p-4">
          <h2 className="section-title mb-3">Pending join requests</h2>
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
                    <div className="text-sm font-medium truncate">
                      {r.trainer?.name ?? r.trainer_id}
                    </div>
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
  members: Array<{ trainer_id: string; role: string }>;
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

  const myMember = signedIn ? members.find((m) => ownedIds.has(m.trainer_id)) : undefined;

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
                toast.success("Left gym");
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
        to join this gym.
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
              await respondToTrainerOrgInvite({
                data: { inviteId: pendingInvite.id, action: "accept" },
              });
              toast.success("Joined gym");
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
              await respondToTrainerOrgInvite({
                data: { inviteId: pendingInvite.id, action: "decline" },
              });
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

function MembersSection({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const auth = useAuth();
  const { data } = useQuery({
    queryKey: ["org-members", orgId],
    queryFn: () => listOrgMembers({ data: { orgId } }),
  });
  const rows = data ?? [];

  async function remove(userId: string) {
    if (!confirm("Remove this member?")) return;
    try {
      await removeGenericOrgMember({ data: { orgId, userId } });
      toast.success("Member removed");
      qc.invalidateQueries({ queryKey: ["org-members", orgId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <section className="rounded-2xl border border-border/60 bg-surface p-4">
      <h2 className="section-title mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-lime" /> Members
        <span className="text-xs font-normal text-muted-foreground">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No members yet.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows.map((m) => {
            const name = m.profile?.display_name || "Member";
            const initials = m.profile?.avatar_initials || name.slice(0, 2).toUpperCase();
            return (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-xl border border-border/50 bg-background px-3 py-2"
              >
                <Link
                  to="/players/$userId"
                  params={{ userId: m.user_id }}
                  className="flex items-center gap-3 min-w-0 flex-1 hover:opacity-80"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-lime/15 text-sm font-semibold overflow-hidden">
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
                    <div className="text-sm font-medium truncate">{name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{m.role}</div>
                  </div>
                </Link>
                {isAdmin && auth.user?.id !== m.user_id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(m.user_id)}
                    aria-label="Remove member"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MemberJoinCta({ orgId }: { orgId: string }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  // The member list is only visible to members and admins, so "am I already a
  // member?" is answered from the viewer's own row instead.
  const access = useQuery({
    queryKey: ["my-org-access", orgId, auth.user?.id ?? "anon"],
    queryFn: () => getMyOrgAccess({ data: { orgId } }),
    enabled: !!auth.user,
  });
  const myReq = useQuery({
    queryKey: ["my-org-member-request", orgId],
    queryFn: () => getMyOrgMemberRequest({ data: { orgId } }),
    enabled: !!auth.user,
  });

  if (!auth.user) return null;
  const isMember = !!access.data?.isMember;
  if (isMember) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-3 py-1 text-xs font-bold text-lime">
          <Check className="h-3 w-3" /> Member
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            if (!confirm("Leave this gym?")) return;
            try {
              await leaveOrgMembership({ data: { orgId } });
              toast.success("Left gym");
              qc.invalidateQueries({ queryKey: ["org-members", orgId] });
              qc.invalidateQueries({ queryKey: ["my-org-access", orgId] });
              qc.invalidateQueries({ queryKey: ["my-org-member-request", orgId] });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed");
            }
          }}
        >
          Leave
        </Button>
      </div>
    );
  }

  const req = myReq.data;

  if (req?.status === "pending") {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
          <Clock className="h-3 w-3" /> Requested — awaiting review
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await withdrawOrgMemberRequest({ data: { id: req.id } });
              toast.success("Withdrawn");
              qc.invalidateQueries({ queryKey: ["my-org-member-request", orgId] });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed");
            }
          }}
        >
          Withdraw
        </Button>
      </div>
    );
  }

  const wasDenied = req?.status === "denied";

  async function submit() {
    setPending(true);
    try {
      await requestOrgMembership({ data: { orgId, message: message.trim() || undefined } });
      toast.success("Request sent");
      setOpen(false);
      setMessage("");
      qc.invalidateQueries({ queryKey: ["my-org-member-request", orgId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex items-start gap-2 flex-wrap">
        {wasDenied && req?.denial_reason && (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
            Denied: {req.denial_reason}
          </span>
        )}
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <UserPlus className="h-3.5 w-3.5 mr-1" />
          {wasDenied ? "Request again" : "Request to join as member"}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request to join</DialogTitle>
            <DialogDescription>
              Add an optional note the admins will see with your request.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Say hi and mention why you'd like to join…"
            maxLength={500}
            rows={4}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AdminMemberRequests({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["org-member-requests", orgId],
    queryFn: () => listOrgMemberRequests({ data: { orgId } }),
  });
  const rows = data ?? [];
  const [denyFor, setDenyFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["org-member-requests", orgId] });
    qc.invalidateQueries({ queryKey: ["org-members", orgId] });
  }

  async function approve(id: string) {
    try {
      await approveOrgMemberRequest({ data: { id } });
      toast.success("Approved");
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  async function deny() {
    if (!denyFor) return;
    setBusy(true);
    try {
      await denyOrgMemberRequest({ data: { id: denyFor, reason: reason.trim() || undefined } });
      toast.success("Denied");
      setDenyFor(null);
      setReason("");
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border/60 bg-surface p-4">
      <h2 className="section-title mb-3">Pending member requests</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No pending requests.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const name = r.profile?.display_name || "User";
            const initials = r.profile?.avatar_initials || name.slice(0, 2).toUpperCase();
            return (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background px-3 py-2"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-lime/15 text-sm font-semibold overflow-hidden">
                    {r.profile?.avatar_url ? (
                      <img
                        src={r.profile.avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      initials
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{name}</div>
                    {r.message && (
                      <div className="text-[11px] text-muted-foreground truncate">{r.message}</div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="secondary" onClick={() => approve(r.id)}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDenyFor(r.id)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={!!denyFor} onOpenChange={(o) => !o && setDenyFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny request</DialogTitle>
            <DialogDescription>
              Optionally include a reason. The requester will see it.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            maxLength={500}
            rows={3}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDenyFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deny} disabled={busy}>
              Deny
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
