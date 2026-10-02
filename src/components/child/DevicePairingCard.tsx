import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Share2, ShieldCheck, Smartphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatPairingCode, devicePairingDisplayState } from "@/lib/device-pairing";
import {
  useCreateDevicePairing,
  useDevicePairingStatus,
  useRevokeDevicePairing,
} from "@/lib/use-device-pairing";
import { formatRelativeDay } from "@/lib/datetime";

/** Same textarea fallback ProfileShareCard.tsx uses when the Clipboard API is unavailable. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Let a managed child use their own device — a guardian-issued, revocable
 * pairing, never a password. See src/lib/device-pairing.ts for why there is
 * at most one active pairing at a time, and src/routes/devices.pair.tsx for
 * where the code is redeemed.
 */
export function DevicePairingCard({
  childUserId,
  childFirstName,
}: {
  childUserId: string;
  childFirstName: string;
}) {
  const status = useDevicePairingStatus(childUserId);
  const create = useCreateDevicePairing();
  const revoke = useRevokeDevicePairing();
  const [shown, setShown] = useState<{ code: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const display = devicePairingDisplayState(status.data);

  const url = (code: string) =>
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/devices/pair?code=${encodeURIComponent(code)}`;

  const pair = () => {
    create.mutate(
      { childUserId },
      {
        onSuccess: (res) => setShown(res),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not pair a device"),
      },
    );
  };

  const share = async (code: string) => {
    const text = `ballaCity pairing code: ${formatPairingCode(code)}\n${url(code)}`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "Pair your ballaCity device", text, url: url(code) });
        return;
      }
    } catch (e) {
      if ((e as { name?: string } | null)?.name === "AbortError") return;
    }
    const ok = await copyText(text);
    toast[ok ? "success" : "error"](
      ok ? "Code and link copied" : "Couldn't share — copy it by hand",
    );
  };

  const copyLink = async (code: string) => {
    const ok = await copyText(url(code));
    if (!ok) {
      toast.error("Couldn't copy the link");
      return;
    }
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section className="mt-4 rounded-xl border border-border bg-background p-3">
      <h3 className="flex items-center gap-2 text-sm font-bold">
        <Smartphone className="h-4 w-4" aria-hidden /> Their own device
      </h3>

      {display.kind === "paired" ? (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            Paired{display.deviceLabel ? ` — ${display.deviceLabel}` : ""} since{" "}
            {formatRelativeDay(display.pairedAt)}. {childFirstName} can open ballaCity there — no
            password needed.
          </p>
          <Button
            size="sm"
            variant="destructive"
            className="mt-3"
            disabled={revoke.isPending}
            onClick={() => {
              const ok = window.confirm(
                `End ${childFirstName}'s device pairing? This signs them out everywhere, including anywhere you're currently acting as them — pair again to let them back in.`,
              );
              if (!ok) return;
              revoke.mutate(
                { childUserId },
                {
                  onSuccess: () => toast.success("Device pairing ended."),
                  onError: (e) =>
                    toast.error(e instanceof Error ? e.message : "Could not end that pairing"),
                },
              );
            }}
          >
            Revoke
          </Button>
        </>
      ) : (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            {display.kind === "pending"
              ? `A code was sent and is waiting to be used. ${childFirstName} can open ballaCity on their own tablet or phone — no password.`
              : `Let ${childFirstName} open ballaCity on their own tablet or phone — no password, and you can end it any time.`}
          </p>
          <Button size="sm" className="mt-3" disabled={create.isPending} onClick={pair}>
            {create.isPending
              ? "Creating a code…"
              : display.kind === "pending"
                ? "Show a new code"
                : "Let them use their own device"}
          </Button>
        </>
      )}

      <Dialog open={!!shown} onOpenChange={(open) => !open && setShown(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Pair {childFirstName}'s device</DialogTitle>
            <DialogDescription>
              Enter this on their tablet or phone at ballacity.app/devices/pair — or share the link.
            </DialogDescription>
          </DialogHeader>

          {shown ? (
            <>
              <div className="rounded-2xl border border-border bg-surface py-5 text-center">
                <div
                  data-testid="pairing-code"
                  data-code={shown.code}
                  className="font-display text-2xl font-bold tracking-[0.2em]"
                >
                  {formatPairingCode(shown.code)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Valid for about 10 minutes</div>
              </div>

              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => void share(shown.code)}>
                  <Share2 className="mr-1.5 h-4 w-4" /> Share
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => void copyLink(shown.code)}
                >
                  {copied ? (
                    <Check className="mr-1.5 h-4 w-4" />
                  ) : (
                    <Copy className="mr-1.5 h-4 w-4" />
                  )}
                  Copy link
                </Button>
              </div>

              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {childFirstName} will be able to open ballaCity on that device until you revoke it —
                no password is ever created.
              </p>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
