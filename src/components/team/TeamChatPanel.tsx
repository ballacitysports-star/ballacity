import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EyeOff, Eye, Flag, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { blockedMessage } from "@/lib/post-moderation";
import { formatWhen } from "@/lib/format";
import { sendTeamChatMessage } from "@/lib/team-chat.functions";
import {
  listTeamChat,
  teamChatErrorMessage,
  type TeamChatClient,
  type TeamChatMessage,
} from "@/lib/team-chat";

const client = supabase as unknown as TeamChatClient;

/**
 * P2-3: a team's group chat. Rendered only for people the database puts in the chat (see
 * useTeamChatAccess). Messages are AI-screened before they are stored; members can report a
 * message; staff can hide and unhide one. Text only. Refreshes every 15 seconds.
 */
export function TeamChatPanel({
  teamId,
  viewerId,
  isStaff,
}: {
  teamId: string;
  viewerId: string;
  isStaff: boolean;
}) {
  const qc = useQueryClient();
  const send = useServerFn(sendTeamChatMessage);
  const [body, setBody] = useState("");
  const key = ["team-chat", teamId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => listTeamChat(client, teamId),
    refetchInterval: 15_000,
  });

  const post = useMutation({
    mutationFn: () => send({ data: { teamId, body: body.trim() } }),
    onSuccess: (r) => {
      setBody("");
      if (r.held) toast.message("Sent for review. It appears once a moderator approves it.");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) =>
      toast.error(
        blockedMessage(e) ?? teamChatErrorMessage(e instanceof Error ? e.message : String(e)),
      ),
  });
  const hide = useMutation({
    mutationFn: async (m: TeamChatMessage) => {
      const { error } = await client.rpc("hide_team_chat_message", {
        _message: m.id,
        _hide: !m.hidden,
      });
      if (error) throw new Error(teamChatErrorMessage(error.message));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const report = useMutation({
    mutationFn: async (m: TeamChatMessage) => {
      const { error } = await client.rpc("report_team_chat_message", {
        _message: m.id,
        _reason: "inappropriate",
        _details: null,
      });
      if (error) throw new Error(teamChatErrorMessage(error.message));
    },
    onSuccess: () => toast.success("Reported. A moderator will look at it."),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const items = q.data ?? [];
  return (
    <section aria-label="Team chat" className="mt-5 space-y-3">
      <p className="text-xs text-muted-foreground">
        Everyone on the team and the parents of younger players can read this chat. Be kind;
        messages are checked before they appear.
      </p>
      {q.isLoading ? (
        <Loader2 className="mx-auto h-5 w-5 animate-spin" aria-label="Loading messages" />
      ) : q.isError ? (
        <p className="text-sm text-muted-foreground">Messages couldn&apos;t load.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages yet. Say hello to the team.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((m) => (
            <li
              key={m.id}
              className={`rounded-xl border border-border bg-surface p-3 ${m.hidden ? "opacity-60" : ""}`}
            >
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {m.senderId === viewerId ? "You" : m.senderName}
                </span>
                <span>{formatWhen(m.createdAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
              <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                {m.status !== "approved" && (
                  <span>{m.status === "held" ? "Held for review" : "Checking…"}</span>
                )}
                {m.hidden && <span>Hidden by staff</span>}
                {m.senderId !== viewerId && m.status === "approved" && (
                  <button
                    type="button"
                    onClick={() => report.mutate(m)}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    aria-label={`Report message from ${m.senderName}`}
                  >
                    <Flag className="h-3 w-3" aria-hidden /> Report
                  </button>
                )}
                {isStaff && m.status === "approved" && (
                  <button
                    type="button"
                    onClick={() => hide.mutate(m)}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {m.hidden ? (
                      <Eye className="h-3 w-3" aria-hidden />
                    ) : (
                      <EyeOff className="h-3 w-3" aria-hidden />
                    )}
                    {m.hidden ? "Unhide" : "Hide"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) post.mutate();
        }}
      >
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="Message the team"
          aria-label="Message the team"
        />
        <Button type="submit" disabled={!body.trim() || post.isPending} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </section>
  );
}
