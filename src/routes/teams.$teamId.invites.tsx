import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Shield } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import { useTeamPermissions, useTeamRoster } from "@/lib/team-roster";
import { InvitesTab } from "@/components/team/manage/InvitesTab";
import { InviteTracker } from "@/components/team/manage/InviteTracker";

export const Route = createFileRoute("/teams/$teamId/invites")({
  head: () =>
    pageHead({
      title: "Roster invites — BallaCity",
      description: "Invite athletes to your team, track replies and collect waivers.",
      noindex: true,
    }),
  ssr: false,
  component: TeamInvitesPage,
});

function TeamInvitesPage() {
  const { teamId } = Route.useParams();
  const roster = useTeamRoster(teamId);
  const perms = useTeamPermissions(teamId);
  const team = useQuery({
    queryKey: ["team-name", teamId],
    queryFn: async () => (await supabase.from("teams").select("id,name").eq("id", teamId).maybeSingle()).data,
  });

  if (roster.isLoading || team.isLoading)
    return (
      <div className="page-shell-prose pt-24 text-center text-sm text-muted-foreground">
        <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  if (!perms.canInvite)
    return (
      <div className="page-shell-prose pt-24 text-center">
        <Shield className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Only this team's owner, managers and coaches can send invites.</p>
      </div>
    );

  const teamName = team.data?.name ?? "your team";
  return (
    <div className="page-shell-prose space-y-6 pb-24 pt-4">
      <Link to="/teams/$teamId/manage" params={{ teamId }} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Manage {teamName}
      </Link>
      <header>
        <h1 className="page-title">Roster invites</h1>
        <p className="page-subtitle">Invite athletes directly, see who replies, and collect waivers before they join.</p>
      </header>
      <InvitesTab teamId={teamId} teamName={teamName} />
      <InviteTracker teamId={teamId} />
    </div>
  );
}
