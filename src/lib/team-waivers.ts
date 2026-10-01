/**
 * Per-team liability waivers: versioned content a manager drafts and
 * publishes, and signatures members (or a guardian, on a minor's behalf)
 * give against the team's current published version.
 *
 * Authorization lives in Postgres, the same as team-roster.ts: every write
 * goes through a SECURITY DEFINER RPC that re-checks the caller, and this
 * module exists to keep the UI honest about what the server will allow.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

// team_waivers/team_waiver_signatures aren't yet in the generated Database
// type until this migration ships live and Lovable regenerates it (same
// transient gap other new-table/RPC code in this repo has hit before
// regen — see src/lib/guardian-emergency-contact.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const waiversDb = supabase as any;

export type TeamWaiver = {
  id: string;
  teamId: string;
  version: string;
  title: string;
  content: string;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
};

export type TeamWaiverSignature = {
  id: string;
  waiverId: string;
  signerUserId: string;
  signedBy: string | null;
  signedAt: string;
};

export type GuardianUnsignedWaiver = {
  childUserId: string;
  teamId: string;
  teamName: string;
  waiverId: string;
  childDisplayName: string;
};

export function teamWaiverErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : String((err as { message?: string })?.message ?? err ?? "");
  if (raw.includes("NOT_TEAM_MANAGER"))
    return "Only the team's owner, managers or coaches can do that.";
  if (raw.includes("WAIVER_NOT_FOUND")) return "That waiver no longer exists.";
  if (raw.includes("EMPTY_WAIVER")) return "Add some content before publishing.";
  if (raw.includes("WAIVER_NOT_PUBLISHED")) return "This waiver hasn't been published yet.";
  if (raw.includes("NOT_YOUR_GUARDIAN_LINK")) return "You're not this player's guardian on file.";
  if (raw.includes("ATTESTATION_REQUIRED")) return "Confirm you're signing on your child's behalf.";
  if (raw.includes("NOT_TEAM_MEMBER_OR_INVITEE"))
    return "Only a team member or someone invited can sign this team's waiver.";
  if (raw.includes("AUTH_REQUIRED")) return "Sign in to manage this team's waiver.";
  return "Couldn't update the waiver. Try again.";
}

function mapWaiver(r: Record<string, unknown>): TeamWaiver {
  return {
    id: String(r["id"]),
    teamId: String(r["team_id"]),
    version: String(r["version"]),
    title: String(r["title"]),
    content: String(r["content"]),
    published: !!r["published"],
    publishedAt: (r["published_at"] as string) ?? null,
    createdAt: String(r["created_at"]),
  };
}

/** The team's current published waiver, if any, plus whether the viewer has signed it. */
export function useTeamWaiver(teamId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["team-waiver", teamId],
    queryFn: async (): Promise<{ waiver: TeamWaiver | null; signedByMe: boolean }> => {
      const { data, error } = await waiversDb
        .from("team_waivers")
        .select("*")
        .eq("team_id", teamId!)
        .eq("published", true)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { waiver: null, signedByMe: false };
      const waiver = mapWaiver(data as Record<string, unknown>);
      if (!user) return { waiver, signedByMe: false };
      const { data: sig } = await waiversDb
        .from("team_waiver_signatures")
        .select("id")
        .eq("waiver_id", waiver.id)
        .eq("signer_user_id", user.id)
        .maybeSingle();
      return { waiver, signedByMe: !!sig };
    },
    enabled: !!teamId,
    staleTime: 15_000,
  });
}

/** Every draft and published waiver a team has had, for its manage screen. */
export function useTeamWaiverHistory(teamId: string | undefined) {
  return useQuery({
    queryKey: ["team-waiver-history", teamId],
    queryFn: async (): Promise<TeamWaiver[]> => {
      const { data, error } = await waiversDb
        .from("team_waivers")
        .select("*")
        .eq("team_id", teamId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(mapWaiver);
    },
    enabled: !!teamId,
    staleTime: 15_000,
  });
}

function invalidateWaiver(qc: ReturnType<typeof useQueryClient>, teamId: string) {
  qc.invalidateQueries({ queryKey: ["team-waiver", teamId] });
  qc.invalidateQueries({ queryKey: ["team-waiver-history", teamId] });
}

export function useCreateWaiverDraft(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { version: string; title: string; content: string }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("AUTH_REQUIRED");
      const { error } = await waiversDb.from("team_waivers").insert({
        team_id: teamId,
        version: v.version,
        title: v.title,
        content: v.content,
        created_by: u.user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateWaiver(qc, teamId),
  });
}

export function usePublishTeamWaiver(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (waiverId: string) => {
      const { error } = await waiversDb.rpc("publish_team_waiver", { _id: waiverId });
      if (error) throw error;
    },
    onSuccess: () => invalidateWaiver(qc, teamId),
  });
}

/** Sign the team's current published waiver — for yourself, or (as a guardian) for a managed minor. */
export function useSignTeamWaiver(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { waiverId: string; onBehalfOf?: string; attested?: boolean }) => {
      const { error } = await waiversDb.rpc("sign_team_waiver", {
        _team_id: teamId,
        _waiver_id: v.waiverId,
        _on_behalf_of: v.onBehalfOf ?? null,
        _attested: v.attested ?? false,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateWaiver(qc, teamId),
  });
}

/**
 * Every managed child with a team whose current published waiver they
 * haven't signed — the Parent Center's pending-waiver nudge. Built from the
 * guardian's own team-invite/membership visibility rather than a dedicated
 * RPC: there's no single query that joins "my children" x "their teams" x
 * "unsigned waivers" without one, and this list is short in practice.
 */
export function useMyChildrensUnsignedWaivers(childUserIds: string[]) {
  return useQuery({
    queryKey: ["my-childrens-unsigned-waivers", childUserIds],
    queryFn: async (): Promise<GuardianUnsignedWaiver[]> => {
      if (childUserIds.length === 0) return [];
      const { data: memberships, error } = await supabase
        .from("team_members")
        .select("team_id, user_id")
        .in("user_id", childUserIds);
      if (error) throw error;
      const rows = (memberships ?? []) as { team_id: string; user_id: string }[];
      if (rows.length === 0) return [];

      const teamIds = [...new Set(rows.map((r) => r.team_id))];
      const { data: waivers } = await waiversDb
        .from("team_waivers")
        .select("id, team_id, published")
        .in("team_id", teamIds)
        .eq("published", true);
      const publishedByTeam = new Map(
        ((waivers ?? []) as Record<string, unknown>[]).map((w) => [String(w["team_id"]), w]),
      );
      if (publishedByTeam.size === 0) return [];

      const waiverIds = [...publishedByTeam.values()].map((w) => String(w["id"]));
      const [{ data: signatures }, { data: teams }, { data: children }] = await Promise.all([
        waiversDb
          .from("team_waiver_signatures")
          .select("waiver_id, signer_user_id")
          .in("waiver_id", waiverIds)
          .in("signer_user_id", childUserIds),
        supabase.from("teams").select("id, name").in("id", teamIds),
        supabase.from("profiles").select("id, display_name, username").in("id", childUserIds),
      ]);
      const signed = new Set(
        ((signatures ?? []) as Record<string, unknown>[]).map(
          (s) => `${s["waiver_id"]}:${s["signer_user_id"]}`,
        ),
      );
      const teamNames = new Map(
        ((teams ?? []) as Record<string, unknown>[]).map((t) => [
          String(t["id"]),
          String(t["name"]),
        ]),
      );
      const childNames = new Map(
        ((children ?? []) as Record<string, unknown>[]).map((p) => [
          String(p["id"]),
          (p["display_name"] as string) || (p["username"] as string) || "Your child",
        ]),
      );

      return rows
        .map((r) => {
          const w = publishedByTeam.get(r.team_id);
          if (!w) return null;
          const waiverId = String(w["id"]);
          if (signed.has(`${waiverId}:${r.user_id}`)) return null;
          return {
            childUserId: r.user_id,
            teamId: r.team_id,
            teamName: teamNames.get(r.team_id) ?? "A team",
            waiverId,
            childDisplayName: childNames.get(r.user_id) ?? "Your child",
          };
        })
        .filter((v): v is NonNullable<typeof v> => !!v);
    },
    enabled: childUserIds.length > 0,
    staleTime: 15_000,
  });
}
