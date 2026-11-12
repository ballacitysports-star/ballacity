import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { describeMessagingError } from "@/lib/minor-messaging";
import { useAuthSearchHere } from "@/lib/auth-return";

/**
 * "Contact guardian" on a minor's player card. Messages go to the child's
 * guardian, never the child; a signed-out visitor is sent to sign in and comes
 * back to this card.
 */
export function ContactGuardianButton({
  childId,
  childName,
}: {
  childId: string;
  childName: string;
}) {
  const navigate = useNavigate();
  const authSearch = useAuthSearchHere();
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        navigate({ to: "/auth", search: authSearch });
        return;
      }
      const { data: guardianId, error } = await supabase.rpc("public_minor_guardian", {
        _child: childId,
      });
      if (error || !guardianId) throw new Error("Guardian contact isn't available right now.");
      const { getOrCreateDirectConversation, sendMessage } = await import("@/lib/messages");
      const convoId = await getOrCreateDirectConversation(guardianId as string);
      try {
        await sendMessage(convoId, `Inquiry regarding ${childName}`);
      } catch {
        /* intro line is optional */
      }
      navigate({ to: "/messages/$conversationId", params: { conversationId: convoId } });
    } catch (e) {
      toast.error(describeMessagingError(e, "Could not contact guardian.", "guardian"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="mt-2 inline-flex w-full items-center justify-center rounded-full border border-border px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
      >
        {busy ? "Opening…" : "Contact guardian"}
      </button>
      <p className="mt-1 text-center text-xs text-muted-foreground">
        This athlete is a minor. Messages go to their parent/guardian. Sign-in required.
      </p>
    </>
  );
}
