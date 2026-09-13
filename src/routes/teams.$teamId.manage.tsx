import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Shield } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTeamPermissions, useTeamRoster } from "@/lib/team-roster";
import { RosterTab } from "@/components/team/manage/RosterTab";
import { InvitesTab } from "@/components/team/manage/InvitesTab";
import { SettingsTab } from "@/components/team/manage/SettingsTab";

export const Route = createFileRoute("/teams/$teamId/manage")({
  head: () =>
    pageHead({
      title: "Manage team — ballaCity",
      description: "Manage your team's roster, invitations and ownership.",
      noindex: true,
    }),
  ssr: false,
  component: ManageTeam,
});

function ManageTeam() {
  const { teamId } = Route.useParams();
  const roster = useTeamRoster(teamId);
  const perms = useTeamPermissions(teamId);

  const team = useQuery({
    queryKey: ["team-name", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name")
        .eq("id", teamId)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; name: string } | null;
    },
    staleTime: 60_000,
  });

  const teamName = team.data?.name ?? "your team";

  // The roster is what `useTeamPermissions` derives the viewer's role from, so
  // the gate cannot be judged until it has loaded.
  if (roster.isLoading || team.isLoading) {
    return (
      <div className="page-shell-prose pt-24 text-center text-sm text-muted-foreground">
        <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!perms.canInvite) {
    return (
      <div className="page-shell-prose pt-24 text-center">
        <Shield className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Only this team's owner, managers and coaches can manage it.
        </p>
        <Link
          to="/teams/$teamId"
          params={{ teamId }}
          className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
        >
          Back to the team
        </Link>
      </div>
    );
  }

  return (
    <div className="page-shell-prose space-y-5 pb-24 pt-4">
      <Link
        to="/teams/$teamId"
        params={{ teamId }}
        className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {teamName}
      </Link>

      <header>
        <h1 className="page-title">Manage team</h1>
        <p className="page-subtitle">
          Roster, invitations and ownership for {teamName}.
        </p>
      </header>

      <Tabs defaultValue="roster">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="roster">Roster</TabsTrigger>
          <TabsTrigger value="invites">Invitations</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="roster" className="pt-4">
          <RosterTab teamId={teamId} teamName={teamName} />
        </TabsContent>
        <TabsContent value="invites" className="pt-4">
          <InvitesTab teamId={teamId} teamName={teamName} />
        </TabsContent>
        <TabsContent value="settings" className="pt-4">
          <SettingsTab teamId={teamId} teamName={teamName} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
