import { useState } from "react";
import { FileSignature } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSignWaiver, waiverErrorMessage, type TeamWaiver } from "@/lib/team-waivers";

/**
 * Shows a team's waiver and records a signature. When `onBehalfOf` is set,
 * a guardian signs for that child and must tick the attestation box.
 */
export function SignWaiverDialog({
  open,
  onOpenChange,
  waiver,
  teamName,
  onBehalfOf,
  childName,
  onSigned,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  waiver: TeamWaiver | null;
  teamName: string;
  onBehalfOf?: string | null;
  childName?: string;
  onSigned?: () => void;
}) {
  const sign = useSignWaiver();
  const [agreed, setAgreed] = useState(false);
  const guardian = !!onBehalfOf;

  if (!waiver) return null;

  const submit = () =>
    sign.mutate(
      { teamId: waiver.teamId, waiverId: waiver.id, onBehalfOf, attested: guardian && agreed },
      {
        onSuccess: () => {
          toast.success("Waiver signed");
          setAgreed(false);
          onOpenChange(false);
          onSigned?.();
        },
        onError: (e) => toast.error(waiverErrorMessage(e)),
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <FileSignature className="h-5 w-5" /> {waiver.title}
          </DialogTitle>
          <DialogDescription>
            {teamName} requires this waiver (version {waiver.version}) before joining.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-surface p-3 text-sm">
          {waiver.content}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            {guardian
              ? `I am ${childName ?? "this child"}'s parent or legal guardian, and I agree to this waiver on their behalf.`
              : "I have read and agree to this waiver."}
          </span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!agreed || sign.isPending} onClick={submit}>
            {sign.isPending ? "Signing…" : "Sign waiver"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
