import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { requestPushPermission } from "@/lib/notifications";
import { MEMBER_PUSH_COPY } from "@/lib/push-prompt";

/**
 * Operations: turns push on for this device from the push delivery test, through the app's one enable path.
 * Unlike the member prompt in Notifications it ignores that prompt's dismissal, so an operator who once
 * dismissed it can still opt this device in.
 */
export function PushOptInButton({ onDone }: { onDone?: (subscribed: boolean) => void }) {
  const [busy, setBusy] = useState(false);

  const enable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { permission, subscribed } = await requestPushPermission();
      if (subscribed) toast.success(MEMBER_PUSH_COPY.enabled);
      else if (permission === "denied") toast.error(MEMBER_PUSH_COPY.blockedToast);
      else if (permission === "unsupported")
        toast.error("This browser doesn't support push notifications.");
      else toast.error(MEMBER_PUSH_COPY.failed);
      onDone?.(subscribed);
    } catch {
      toast.error(MEMBER_PUSH_COPY.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button size="sm" variant="outline" onClick={enable} disabled={busy}>
      {busy ? "Turning on…" : "Turn on push on this device"}
    </Button>
  );
}
