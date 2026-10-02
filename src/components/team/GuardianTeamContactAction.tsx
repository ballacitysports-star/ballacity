import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useParentMode } from "@/hooks/use-parent-mode";
import {
  listGuardianTeamContacts,
  type GuardianTeamContact,
} from "@/lib/guardian-team-contacts.functions";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { describeMessagingError } from "@/lib/minor-messaging";

const ROLE_LABEL = { owner: "Owner", manager: "Manager", coach: "Coach" } as const;

function ContactAvatar({ contact }: { contact: GuardianTeamContact }) {
  if (contact.avatarUrl) {
    return <img src={contact.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />;
  }
  return (
    <div className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-xs font-bold">
      {contact.initials ?? contact.displayName.slice(0, 2).toUpperCase()}
    </div>
  );
}

export function GuardianTeamContactAction({ teamId }: { teamId: string }) {
  const navigate = useNavigate();
  const { isParentMode, isLoading: parentModeLoading } = useParentMode();
  const listContacts = useServerFn(listGuardianTeamContacts);
  const [open, setOpen] = useState(false);
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);
  const contacts = useQuery({
    queryKey: ["guardian-team-contacts", teamId],
    queryFn: () => listContacts({ data: { teamId } }),
    enabled: isParentMode,
    staleTime: 30_000,
    retry: false,
  });

  if (parentModeLoading || !isParentMode || contacts.isLoading || !contacts.data?.length) {
    return null;
  }

  const openConversation = async (contact: GuardianTeamContact) => {
    setOpeningUserId(contact.userId);
    try {
      const conversationId = await getOrCreateDirectConversation(contact.userId);
      setOpen(false);
      await navigate({
        to: "/messages/$conversationId",
        params: { conversationId },
      });
    } catch (error) {
      toast.error(describeMessagingError(error, "Couldn't message this team leader."));
    } finally {
      setOpeningUserId(null);
    }
  };

  const handleAction = () => {
    const first = contacts.data?.[0];
    if (!first) return;
    if (contacts.data.length === 1) {
      void openConversation(first);
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={handleAction}
        disabled={openingUserId !== null}
        className="rounded-full bg-surface"
      >
        {openingUserId ? <Loader2 className="animate-spin" /> : <MessageCircle />}
        Message team
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Message team leadership</DialogTitle>
            <DialogDescription>Choose who you want to contact about your child.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {contacts.data.map((contact) => (
              <Button
                key={contact.userId}
                type="button"
                variant="outline"
                onClick={() => void openConversation(contact)}
                disabled={openingUserId !== null}
                className="h-auto w-full justify-start whitespace-normal px-3 py-3 text-left"
              >
                <ContactAvatar contact={contact} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{contact.displayName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {ROLE_LABEL[contact.role]}
                  </span>
                </span>
                {openingUserId === contact.userId && <Loader2 className="animate-spin" />}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}