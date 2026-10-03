/**
 * Team liability waivers. All authorization lives in Postgres (RLS +
 * publish_team_waiver / sign_team_waiver SECURITY DEFINER RPCs); this module
 * only reads state and translates error codes.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type TeamWaiver = {
  id: string;
  teamId: string;
  version: string;
  title: string;
  content: string;
  published: boolean;
  publishedAt: string | null;
};

export type WaiverSignature = {
  waiverId: string;
  signerUserId: string;
  signedBy: string | null;
  signedAt: string;
};

const db = supabase as any;

function mapWaiver(r: Record<string, any>): TeamWaiver {
  return {
    id: String(r["id"]),
    teamId: String(r["team_id"]),
    version: String(r["version"] ?? ""),
    title: String(r["title"] ?? "Team waiver"),
    content: String(r["content"] ?? ""),
    published: !!r["published"],
    publishedAt: (r["published_at"] as string) ?? null,
  };
}

/** The team's currently published waiver (null when none, or not visible). */
export function usePublishedWaiver(teamId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["team-waiver", "published", teamId, user?.id],
    queryFn: async (): Promise<TeamWaiver | null> => {
      const { data, error } = await db
        .from("team_waivers")
        .select("*")
        .eq("team_id", teamId)
        .eq("published", true)
        .maybeSingle();
      if (error) throw error;
      return data ? mapWaiver(data) : null;
    },
    enabled: !!teamId && !!user,
    staleTime: 30_000,
  });
}

/** Whether `signerId` (default: me) has signed the given waiver. */
export function useWaiverSigned(waiverId: string | undefined, signerId?: string) {
  const { user } = useAuth();
  const who = signerId ?? user?.id;
  return useQuery({
    queryKey: ["team-waiver", "signed", waiverId, who],
    queryFn: async () => {
      const { data, error } = await db
        .from("team_waiver_signatures")
        .select("id")
        .eq("waiver_id", waiverId)
        .eq("signer_user_id", who)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
    enabled: !!waiverId && !!who,
  });
}

/** Look up a team's published waiver + signed state imperatively (for accept flows). */
export async function fetchWaiverRequirement(
  teamId: string,
  signerId: string,
): Promise<{ waiver: TeamWaiver; signed: boolean } | null> {
  const { data, error } = await db
    .from("team_waivers")
    .select("*")
    .eq("team_id", teamId)
    .eq("published", true)
    .maybeSingle();
  if (error || !data) return null;
  const waiver = mapWaiver(data);
  const { data: sig } = await db
    .from("team_waiver_signatures")
    .select("id")
    .eq("waiver_id", waiver.id)
    .eq("signer_user_id", signerId)
    .maybeSingle();
  return { waiver, signed: !!sig };
}

/** All waivers for a team (managers see drafts + archived via RLS). */
export function useTeamWaivers(teamId: string) {
  return useQuery({
    queryKey: ["team-waiver", "all", teamId],
    queryFn: async (): Promise<TeamWaiver[]> => {
      const { data, error } = await db
        .from("team_waivers")
        .select("*")
        .eq("team_id", teamId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as Record<string, any>[]).map(mapWaiver);
    },
  });
}

export function useWaiverSignatures(waiverId: string | undefined) {
  return useQuery({
    queryKey: ["team-waiver", "signatures", waiverId],
    queryFn: async (): Promise<WaiverSignature[]> => {
      const { data, error } = await db
        .from("team_waiver_signatures")
        .select("waiver_id, signer_user_id, signed_by, signed_at")
        .eq("waiver_id", waiverId);
      if (error) throw error;
      return ((data ?? []) as Record<string, any>[]).map((r) => ({
        waiverId: String(r["waiver_id"]),
        signerUserId: String(r["signer_user_id"]),
        signedBy: (r["signed_by"] as string) ?? null,
        signedAt: String(r["signed_at"]),
      }));
    },
    enabled: !!waiverId,
  });
}

export function useCreateAndPublishWaiver(teamId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (v: { version: string; title: string; content: string }) => {
      const { data, error } = await db
        .from("team_waivers")
        .insert({
          team_id: teamId,
          version: v.version.trim(),
          title: v.title.trim(),
          content: v.content.trim(),
          created_by: user!.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      const { error: pubErr } = await db.rpc("publish_team_waiver", { _id: data.id });
      if (pubErr) throw pubErr;
      return data.id as string;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["team-waiver"] }),
  });
}

/** Create or update an unpublished draft. Returns the draft id. */
export function useSaveWaiverDraft(teamId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (v: { id?: string | null; version: string; title: string; content: string }) => {
      const row = { version: v.version.trim(), title: v.title.trim(), content: v.content.trim() };
      if (v.id) {
        const { error } = await db
          .from("team_waivers")
          .update(row)
          .eq("id", v.id)
          .is("published_at", null);
        if (error) throw error;
        return v.id;
      }
      const { data, error } = await db
        .from("team_waivers")
        .insert({ ...row, team_id: teamId, created_by: user!.id })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["team-waiver"] }),
  });
}

export function usePublishWaiverDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("publish_team_waiver", { _id: id });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["team-waiver"] }),
  });
}

export function useDeleteWaiverDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("team_waivers").delete().eq("id", id).is("published_at", null);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["team-waiver"] }),
  });
}

export function useSignWaiver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      teamId: string;
      waiverId: string;
      onBehalfOf?: string | null;
      attested?: boolean;
    }) => {
      const { error } = await db.rpc("sign_team_waiver", {
        _team_id: v.teamId,
        _waiver_id: v.waiverId,
        _on_behalf_of: v.onBehalfOf ?? null,
        _attested: !!v.attested,
      });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["team-waiver"] }),
  });
}

export function waiverErrorMessage(err: unknown): string {
  const raw = String((err as { message?: string })?.message ?? err ?? "");
  if (raw.includes("NOT_YOUR_GUARDIAN_LINK")) return "You're not a linked guardian for this player.";
  if (raw.includes("ATTESTATION_REQUIRED")) return "Confirm you're signing on your child's behalf.";
  if (raw.includes("WAIVER_NOT_PUBLISHED")) return "This waiver was replaced. Reload and try again.";
  if (raw.includes("NOT_TEAM_MEMBER_OR_INVITEE"))
    return "Only team members or invited players can sign this waiver.";
  if (raw.includes("NOT_TEAM_MANAGER")) return "Only the team's owner, managers or coaches can do that.";
  if (raw.includes("EMPTY_WAIVER")) return "Add waiver text before publishing.";
  if (raw.includes("duplicate key")) return "That version name is already used. Pick another.";
  if (raw.includes("AUTH_REQUIRED")) return "Sign in first.";
  return "Couldn't save the waiver. Try again.";
}
