import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarDays,
  Check,
  ClipboardList,
  FileSignature,
  Loader2,
  Mail,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { UserAvatar } from "@/components/UserAvatar";
import { getTeamInviteTracker, getTeamRosterOverview } from "@/lib/tryouts.functions";
import { WaiverBadge } from "./WaiverBadge";

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Manager dashboard: posts, invites, RSVPs and waivers in one glance.
 * Reuses the manager-authorized roster overview and invite tracker server
 * functions, so no new permission logic lives here.
 */
export function DashboardTab({ teamId, teamName }: { teamId: string; teamName: string }) {
  const rosterFn = useServerFn(getTeamRosterOverview);
  const invitesFn = useServerFn(getTeamInviteTracker);

  const roster = useQuery({
    queryKey: ["team-roster-overview", teamId],
    queryFn: () => rosterFn({ data: { teamId } }),
    refetchInterval: 30_000,
  });
  const invites = useQuery({
    queryKey: ["team-invite-tracker", teamId],
    queryFn: () => invitesFn({ data: { teamId } }),
    refetchInterval: 30_000,
  });
  const posts = useQuery({
    queryKey: ["team-posts-summary", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_posts")
        .select("id,kind,event_date")
        .eq("team_id", teamId)
        .is("hidden_at", null);
      if (error) throw error;
      const rows = data ?? [];
      const now = Date.now();
      return {
        total: rows.length,
        upcoming: rows.filter((r) => r.event_date && new Date(r.event_date).getTime() >= now).length,
        tryouts: rows.filter((r) => r.kind === "tryout" || r.kind === "clinic").length,
        announcements: rows.filter((r) => r.kind === "announcement").length,
      };
    },
    staleTime: 30_000,
  });

  if (roster.isLoading || invites.isLoading)
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading dashboard…
      </div>
    );
  if (roster.error || !roster.data || invites.error || !invites.data)
    return <p className="text-sm text-coral">Couldn't load the dashboard. Try again in a moment.</p>;

  const { members, events, waiverVersion } = roster.data;
  const inv = invites.data.invites;
  const now = Date.now();
  const upcomingEvents = events
    .filter((e) => e.eventDate && new Date(e.eventDate).getTime() >= now)
    .sort((a, b) => new Date(a.eventDate!).getTime() - new Date(b.eventDate!).getTime());
  const signedCount = members.filter((m) => m.waiver).length;
  const waiting = inv.filter((i) => i.status === "pending");
  const needsGuardian = waiting.filter((i) => i.needsGuardian && !i.guardianApproved).length;
  const joined = inv.filter((i) => i.status === "accepted").length;
  const totalRsvps = upcomingEvents.reduce(
    (n, e) => n + e.rsvps.filter((r) => r.status === "registered").length,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Users className="h-3.5 w-3.5" />} label="Roster" value={members.length} hint="players & staff" />
        <StatCard
          icon={<CalendarDays className="h-3.5 w-3.5" />}
          label="Events"
          value={upcomingEvents.length}
          hint={`${totalRsvps} RSVP${totalRsvps === 1 ? "" : "s"} upcoming`}
        />
        <StatCard
          icon={<Mail className="h-3.5 w-3.5" />}
          label="Invites"
          value={waiting.length}
          hint={`${joined} joined${needsGuardian ? ` · ${needsGuardian} need guardian OK` : ""}`}
        />
        <StatCard
          icon={<FileSignature className="h-3.5 w-3.5" />}
          label="Waivers"
          value={waiverVersion ? `${signedCount}/${members.length}` : "—"}
          hint={waiverVersion ? `v${waiverVersion} signed` : "none published"}
        />
      </div>

      {posts.data && (
        <p className="flex items-start gap-2 rounded-2xl border border-border bg-surface p-3 text-xs text-muted-foreground">
          <ClipboardList className="mt-0.5 h-4 w-4 shrink-0" />
          {posts.data.total} post{posts.data.total === 1 ? "" : "s"} total — {posts.data.tryouts} tryout/camp,{" "}
          {posts.data.announcements} announcement{posts.data.announcements === 1 ? "" : "s"},{" "}
          {posts.data.upcoming} upcoming.
        </p>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-eyebrow text-muted-foreground">Upcoming tryouts &amp; camps</h2>
          <Link
            to="/teams/$teamId/events"
            params={{ teamId }}
            className="rounded-full border border-border px-3 py-1 text-xs font-bold text-muted-foreground"
          >
            Manage events
          </Link>
        </div>
        {upcomingEvents.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nothing scheduled. Post a tryout or camp to start collecting RSVPs.
          </p>
        ) : (
          <ul className="space-y-2">
            {upcomingEvents.slice(0, 5).map((e) => {
              const going = e.rsvps.filter((r) => r.status === "registered");
              const waived = going.filter((r) => r.waiver).length;
              return (
                <li key={e.id} className="rounded-2xl border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">{e.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.eventDate!).toLocaleDateString()} · {going.length}
                      {e.spotsMax ? `/${e.spotsMax}` : ""} going
                    </p>
                  </div>
                  {waiverVersion && going.length > 0 && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      {waived === going.length ? (
                        <Check className="h-3 w-3 text-lime" />
                      ) : (
                        <X className="h-3 w-3 text-coral" />
                      )}
                      {waived}/{going.length} waivers signed
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-eyebrow text-muted-foreground">Pending invites</h2>
          <Link
            to="/teams/$teamId/invites"
            params={{ teamId }}
            className="rounded-full border border-border px-3 py-1 text-xs font-bold text-muted-foreground"
          >
            All invites
          </Link>
        </div>
        {waiting.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No invites waiting on a reply.
          </p>
        ) : (
          <ul className="space-y-2">
            {waiting.slice(0, 5).map((i) => (
              <li key={i.id} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{i.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    sent {new Date(i.sentAt).toLocaleDateString()}
                    {i.needsGuardian && (
                      <span className="inline-flex items-center gap-0.5">
                        {" "}
                        · <ShieldCheck className="inline h-3 w-3" />{" "}
                        {i.guardianApproved ? "guardian approved" : "needs guardian OK"}
                      </span>
                    )}
                  </p>
                </div>
                {invites.data.waiverVersion &&
                  (i.waiverSigned ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[11px] font-bold text-lime">
                      <Check className="h-3 w-3" /> Waiver
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                      <X className="h-3 w-3" /> Waiver
                    </span>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-center text-xs text-muted-foreground">
        Managing {teamName} — details live in the Roster, RSVPs &amp; waivers and Invitations tabs.
      </p>
    </div>
  );
}
