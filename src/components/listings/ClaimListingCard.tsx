import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { BadgeCheck, Loader2, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { listingErrorMessage, useClaimListing, useMyClaim } from "@/lib/listings";
import type { ListingSubjectType } from "@/lib/listings.functions";

/**
 * Shown on a team or gym page that has no owner. Filing a claim does not grant
 * anything on its own — a moderator reviews it first.
 */
export function ClaimListingCard({
  subjectType,
  subjectId,
  name,
}: {
  subjectType: ListingSubjectType;
  subjectId: string;
  name: string;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [evidence, setEvidence] = useState("");
  const { data: claim } = useMyClaim(subjectType, subjectId);
  const { submit, withdraw } = useClaimListing(subjectType, subjectId);

  const noun = subjectType === "gym" ? "gym" : "team";

  if (claim?.status === "pending") {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="font-medium">Your claim is with a moderator</p>
            <p className="text-sm text-muted-foreground">
              We'll let you know once it has been reviewed.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={withdraw.isPending}
            onClick={() =>
              withdraw.mutate(claim.id, {
                onSuccess: () => toast.success("Claim withdrawn"),
                onError: (e) => toast.error(listingErrorMessage(e)),
              })
            }
          >
            {withdraw.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Withdraw
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-dashed">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-2">
            <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="font-medium">Unclaimed listing</p>
              <p className="text-sm text-muted-foreground">
                Nobody manages this {noun} yet. If it's yours, claim it and a moderator will review.
              </p>
            </div>
          </div>

          {claim?.status === "denied" && (
            <p className="rounded-md bg-muted p-3 text-sm">
              Your last claim was declined{claim.denialReason ? `: ${claim.denialReason}` : "."} You
              can file another.
            </p>
          )}

          {user ? (
            <Button className="w-full" onClick={() => setOpen(true)}>
              <BadgeCheck className="mr-2 h-4 w-4" />
              Claim this {noun}
            </Button>
          ) : (
            <Button className="w-full" asChild>
              <Link to="/auth">Sign in to claim</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Claim {name}</DialogTitle>
            <DialogDescription>
              Tell the moderators how you're connected to this {noun}. Approval makes you the owner,
              so it is reviewed by a person.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="claim-message">Why is this yours?</Label>
              <Textarea
                id="claim-message"
                rows={4}
                maxLength={1000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  subjectType === "gym"
                    ? "I'm the owner of this facility…"
                    : "I've coached this team since…"
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="claim-evidence">Link that backs it up (optional)</Label>
              <Input
                id="claim-evidence"
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="https://"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={message.trim().length < 10 || submit.isPending}
              onClick={() =>
                submit.mutate(
                  { message: message.trim(), evidenceUrl: evidence.trim() || undefined },
                  {
                    onSuccess: () => {
                      toast.success("Claim sent for review");
                      setOpen(false);
                      setMessage("");
                      setEvidence("");
                    },
                    onError: (e) => toast.error(listingErrorMessage(e)),
                  },
                )
              }
            >
              {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
