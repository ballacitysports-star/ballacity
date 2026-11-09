/**
 * P2-3: team chat (owner decisions 2026-11-09). The database decides who is in a team's chat
 * (private_sec.team_chat_member: adults on the roster, 13-17s with a linked guardian and teammates
 * messaging, and the guardians of minors on the team) and what each member reads (approved,
 * unhidden messages; their own; staff also see hidden ones). This file only reads what it allows.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const TEAM_CHAT_SETTING_KEY = "team_chat";
export const TEAM_CHAT_PAGE = 50;

export type TeamChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  status: "pending" | "approved" | "held";
  hidden: boolean;
  createdAt: string;
};

type Result = { data: unknown; error: { message: string } | null };
type Q = PromiseLike<Result> & {
  select: (c: string) => Q;
  eq: (c: string, v: unknown) => Q;
  in: (c: string, v: readonly unknown[]) => Q;
  order: (c: string, o?: { ascending?: boolean }) => Q;
  limit: (n: number) => Q;
};
export type TeamChatClient = {
  from: (t: string) => Q;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<Result>;
};

/** Plain words for the database's refusals. */
export function teamChatErrorMessage(message: string): string {
  if (/NOT_IN_TEAM_CHAT/.test(message)) return "You're not in this team's chat.";
  if (/RATE_LIMITED/.test(message)) return "You're sending messages too fast. Wait a moment.";
  if (/INVALID_MESSAGE/.test(message)) return "Write a message first (up to 2,000 characters).";
  if (/NOT_TEAM_STAFF/.test(message)) return "Only the team's staff can do that.";
  if (/CANNOT_REPORT_SELF/.test(message)) return "You can't report your own message.";
  if (/MESSAGE_NOT_FOUND/.test(message)) return "That message isn't available.";
  return message;
}

/** The latest messages the caller may read, oldest first for display. Throws on a read error. */
export async function listTeamChat(
  client: TeamChatClient,
  teamId: string,
): Promise<TeamChatMessage[]> {
  const res = await client
    .from("team_chat_messages")
    .select("id,sender_id,body,moderation_status,hidden_at,created_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(TEAM_CHAT_PAGE);
  if (res.error) throw new Error(teamChatErrorMessage(res.error.message));
  const rows = (res.data ?? []) as {
    id: string;
    sender_id: string;
    body: string;
    moderation_status: TeamChatMessage["status"];
    hidden_at: string | null;
    created_at: string;
  }[];
  const ids = [...new Set(rows.map((r) => r.sender_id))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const p = await client.from("profiles").select("id,display_name").in("id", ids);
    if (!p.error && Array.isArray(p.data)) {
      for (const r of p.data as { id: string; display_name: string | null }[]) {
        names.set(r.id, r.display_name || "Member");
      }
    }
  }
  return rows
    .map((r) => ({
      id: r.id,
      senderId: r.sender_id,
      senderName: names.get(r.sender_id) ?? "Member",
      body: r.body,
      status: r.moderation_status,
      hidden: !!r.hidden_at,
      createdAt: r.created_at,
    }))
    .reverse();
}

/** Whether team chat is switched on and the caller is in this team's chat. Off while loading or on error. */
export function useTeamChatAccess(teamId: string, signedIn: boolean): boolean {
  const q = useQuery({
    queryKey: ["team-chat-access", teamId, signedIn],
    enabled: signedIn,
    staleTime: 60_000,
    queryFn: async () => {
      const s = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", TEAM_CHAT_SETTING_KEY)
        .maybeSingle();
      const on = (s.data as { value?: { enabled?: unknown } } | null)?.value?.enabled === true;
      if (!on) return false;
      const { data, error } = await (supabase.rpc as unknown as TeamChatClient["rpc"])(
        "can_use_team_chat",
        {
          _team: teamId,
        },
      );
      return !error && data === true;
    },
  });
  return q.data === true;
}
