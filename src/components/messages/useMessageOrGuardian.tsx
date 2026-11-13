import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getOrCreateDirectConversation, sendMessage } from "@/lib/messages";
import {
  describeMessagingError,
  isMinorMessagingBlock,
  parseMinorMessagingBlock,
} from "@/lib/minor-messaging";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Blocked = { childId: string; childName: string; guardianId: string | null; reason: string };

/**
 * Opens a DM with a player; when the database refuses because of the player's
 * account, offers to message their guardian instead. The refusal never says
 * why (it is the same for a minor's rules and an adult's own settings), and
 * the guardian is only resolvable when they have authorised contact
 * (public_minor_guardian), so neither the player's age nor a guardian's
 * identity is revealed without that opt-in.
 */
export function useMessageOrGuardian() {
  const navigate = useNavigate();
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [busy, setBusy] = useState(false);

  const startMessage = async (userId: string, name: string) => {
    try {
      const id = await getOrCreateDirectConversation(userId);
      navigate({ to: "/messages/$conversationId", params: { conversationId: id } });
    } catch (e) {
      // Offering the other player's guardian only helps when the refusal is
      // about *their* account. When it is the viewer's own restriction, say
      // so and stop.
      if (!isMinorMessagingBlock(e) || parseMinorMessagingBlock(e)?.side === "self") {
        toast.error(describeMessagingError(e));
        return;
      }
      const { data } = await supabase.rpc("public_minor_guardian", { _child: userId });
      setBlocked({
        childId: userId,
        childName: name || "this player",
        guardianId: (data as string | null) ?? null,
        reason: describeMessagingError(e),
      });
    }
  };

  const messageGuardian = async () => {
    if (!blocked?.guardianId) return;
    setBusy(true);
    try {
      const convoId = await getOrCreateDirectConversation(blocked.guardianId);
      try {
        await sendMessage(convoId, `Inquiry regarding ${blocked.childName}`);
      } catch {
        /* intro line is optional */
      }
      setBlocked(null);
      navigate({ to: "/messages/$conversationId", params: { conversationId: convoId } });
    } catch (e) {
      toast.error(describeMessagingError(e, "Couldn't contact the guardian.", "guardian"));
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <AlertDialog open={!!blocked} onOpenChange={(o) => !o && setBlocked(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Direct messaging is restricted</AlertDialogTitle>
          <AlertDialogDescription>
            {blocked?.reason}
            {blocked?.guardianId
              ? ` You can message ${blocked.childName}'s parent or guardian instead.`
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{blocked?.guardianId ? "Cancel" : "OK"}</AlertDialogCancel>
          {blocked?.guardianId && (
            <AlertDialogAction
              disabled={busy}
              onClick={(ev) => {
                ev.preventDefault();
                void messageGuardian();
              }}
            >
              {busy ? "Opening…" : "Message guardian"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { startMessage, dialog };
}
