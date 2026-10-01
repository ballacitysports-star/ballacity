import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, Smartphone } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import { resetPerUserClientState } from "@/lib/per-user-state";
import { PAIRING_CODE_LENGTH, formatPairingCode, normalizePairingCode } from "@/lib/device-pairing";
import { confirmDevicePairing, lookupDevicePairing } from "@/lib/device-pairing.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const searchSchema = z.object({
  /** From a tapped link or scanned QR. Prefills the form; never auto-submits
   *  — a mis-scan or a forwarded link must not silently pair a device. */
  code: z.string().optional(),
});

export const Route = createFileRoute("/devices/pair")({
  head: () =>
    pageHead({
      path: "/devices/pair",
      title: "Pair this device — ballaCity",
      description: "Enter the code your parent or guardian gave you to open ballaCity here.",
      noindex: true,
    }),
  validateSearch: searchSchema,
  ssr: false,
  component: DevicePairPage,
});

function DevicePairPage() {
  const { code: codeFromUrl } = Route.useSearch();
  const lookup = useServerFn(lookupDevicePairing);
  const confirm = useServerFn(confirmDevicePairing);
  const [code, setCode] = useState(() => normalizePairingCode(codeFromUrl ?? ""));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = code.length === PAIRING_CODE_LENGTH && !working;

  const submit = async () => {
    if (!canSubmit) return;
    setWorking(true);
    setError(null);
    try {
      const { tokenHash } = await lookup({ data: { code } });
      const { error: otpError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "email",
      });
      if (otpError) throw new Error("Could not open ballaCity here. Ask for a new code.");
      // Best-effort: the session exists either way; this only makes the
      // guardian's "paired since …" accurate. Never blocks landing the device.
      await confirm().catch(() => undefined);
      await resetPerUserClientState();
      // Hard reload, same as switchToManagedChild — the whole app re-hydrates
      // for the new session rather than carrying any cached state forward.
      window.location.assign("/feed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setWorking(false);
    }
  };

  return (
    <div className="page-shell-narrow py-10">
      <div className="flex items-center gap-2">
        <Smartphone className="h-5 w-5 text-muted-foreground" />
        <h1 className="page-title">Pair this device</h1>
      </div>
      <p className="mt-2 page-subtitle">
        Enter the code your parent or guardian gave you. It opens ballaCity here — no email or
        password needed.
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <Label htmlFor="pairing-code">Pairing code</Label>
          <Input
            id="pairing-code"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="XXXXX-XXXXX"
            value={formatPairingCode(code)}
            maxLength={PAIRING_CODE_LENGTH + 1}
            onChange={(e) => setCode(normalizePairingCode(e.target.value))}
            disabled={working}
            className="text-center text-lg tracking-widest"
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}

        <Button className="w-full" disabled={!canSubmit} onClick={() => void submit()}>
          {working ? "Opening ballaCity…" : "Pair this device"}
        </Button>

        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Your parent or guardian can end this at any time from their Parent Center.
        </p>
      </div>
    </div>
  );
}
