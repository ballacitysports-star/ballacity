/**
 * "Pair a device": gives a managed child's own phone a one-time link (and QR
 * code) that signs it into their profile — no email or password.
 *
 * Opening the dialog does not make a link; the guardian taps "Create link", so
 * a link never exists unless someone chose to make one. The link works once
 * and for 15 minutes. "Disconnect all devices" signs the child out everywhere.
 */

import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Copy, MessageSquare, Share2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreatePairingLink, useRevokeChildDevices } from "@/lib/use-managed-children";
import { PAIR_LINK_TTL_MINUTES, pairUrl, smsHref } from "@/lib/managed-pairing";

type Link = { url: string; expiresAt: number };

function QrCode({ value }: { value: string }) {
  // Error level M survives a smudged or glary phone screen.
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [value]);
  return (
    <div
      role="img"
      aria-label="QR code for the pairing link"
      className="mx-auto w-44 rounded-xl bg-white p-1 [&_svg]:h-auto [&_svg]:w-full"
      // The markup is generated locally from the link by qrcode-generator.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function useSecondsLeft(expiresAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAt === null) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [expiresAt]);
  return expiresAt === null ? 0 : Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function PairDeviceDialog({
  childUserId,
  childName,
}: {
  childUserId: string;
  childName: string;
}) {
  const first = childName.split(" ")[0];
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<Link | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const create = useCreatePairingLink();
  const revoke = useRevokeChildDevices();
  const secondsLeft = useSecondsLeft(link?.expiresAt ?? null);
  const expired = link !== null && secondsLeft === 0;
  const live = link !== null && !expired;

  const reset = (next: boolean) => {
    setOpen(next);
    // Closing forgets the link: it can't be read back from the server, so a
    // lost one is replaced with a new one rather than recovered.
    if (!next) setLink(null);
  };

  const make = () =>
    create.mutate(
      { childUserId },
      {
        onSuccess: ({ token, expiresAt }) =>
          setLink({
            url: pairUrl(window.location.origin, token),
            expiresAt: new Date(expiresAt).getTime(),
          }),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not make a link"),
      },
    );

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success("Link copied");
    } catch {
      window.prompt("Copy this link:", link.url);
    }
  };

  const share = async () => {
    if (!link) return;
    try {
      await navigator.share({
        title: `${first}'s BallaCity profile`,
        text: `Tap to open ${first}'s BallaCity profile. Works once, for ${PAIR_LINK_TTL_MINUTES} minutes.`,
        url: link.url,
      });
    } catch {
      /* cancelled, or sharing isn't available — the other buttons still work */
    }
  };

  const disconnect = () =>
    revoke.mutate(
      { childUserId },
      {
        onSuccess: () => {
          setLink(null);
          toast.success(`${first} is signed out on every device`);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not disconnect"),
        onSettled: () => setConfirmRevoke(false),
      },
    );

  const mm = String(Math.floor(secondsLeft / 60));
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <>
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => reset(true)}>
        <Smartphone className="mr-1.5 h-4 w-4" aria-hidden />
        Pair a device
      </Button>

      <Dialog open={open} onOpenChange={reset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pair a device for {first}</DialogTitle>
            <DialogDescription>
              Open the link on {first}&apos;s phone to sign it into their profile — no email or
              password. It works once and for {PAIR_LINK_TTL_MINUTES} minutes.
            </DialogDescription>
          </DialogHeader>

          {live && link ? (
            <div className="space-y-3">
              <QrCode value={link.url} />
              <p className="text-center text-xs text-muted-foreground" role="timer">
                Expires in {mm}:{ss}
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Button size="sm" variant="outline" onClick={() => void copy()}>
                  <Copy className="mr-1.5 h-4 w-4" aria-hidden />
                  Copy
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={smsHref(first, link.url)}>
                    <MessageSquare className="mr-1.5 h-4 w-4" aria-hidden />
                    Text
                  </a>
                </Button>
                {typeof navigator !== "undefined" && "share" in navigator ? (
                  <Button size="sm" variant="outline" onClick={() => void share()}>
                    <Share2 className="mr-1.5 h-4 w-4" aria-hidden />
                    Share
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Anyone who opens this link before it expires gets into {first}&apos;s profile, so
                send it only to {first}&apos;s phone.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {expired ? (
                <p className="text-sm text-muted-foreground">
                  That link expired. Make a new one — the old one no longer works.
                </p>
              ) : null}
              <Button className="w-full" disabled={create.isPending} onClick={make}>
                {create.isPending ? "Creating…" : expired ? "Make a new link" : "Create link"}
              </Button>
            </div>
          )}

          <div className="border-t border-border pt-3">
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => setConfirmRevoke(true)}
            >
              Disconnect all of {first}&apos;s devices
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign {first} out everywhere?</AlertDialogTitle>
            <AlertDialogDescription>
              Every phone signed into {first}&apos;s profile is signed out, and any link you made
              stops working. A phone may stay signed in for up to an hour. You can pair a device
              again any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoke.isPending}
              onClick={(e) => {
                e.preventDefault();
                disconnect();
              }}
            >
              {revoke.isPending ? "Signing out…" : "Sign out everywhere"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
