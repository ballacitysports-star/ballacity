import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { teamRosterErrorMessage, useTeamRosterActions, type RosterMember } from "@/lib/team-roster";

export function MemberDetailsDialog({
  teamId,
  member,
  open,
  onOpenChange,
}: {
  teamId: string;
  member: RosterMember | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { setDetails } = useTeamRosterActions(teamId);
  const [jersey, setJersey] = useState("");
  const [position, setPosition] = useState("");

  useEffect(() => {
    setJersey(member?.jerseyNumber ?? "");
    setPosition(member?.position ?? "");
  }, [member]);

  if (!member) return null;

  const save = () =>
    setDetails.mutate(
      {
        userId: member.userId,
        jerseyNumber: jersey.trim() || null,
        position: position.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success(`Updated ${member.displayName}`);
          onOpenChange(false);
        },
        onError: (err) => toast.error(teamRosterErrorMessage(err)),
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Number and position</DialogTitle>
          <DialogDescription>{member.displayName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="jersey">
              Jersey number
            </label>
            <Input
              id="jersey"
              value={jersey}
              onChange={(e) => setJersey(e.target.value)}
              placeholder="e.g. 23"
              maxLength={4}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="position">
              Position
            </label>
            <Input
              id="position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="e.g. Point guard"
              maxLength={40}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={setDetails.isPending}>
            {setDetails.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
