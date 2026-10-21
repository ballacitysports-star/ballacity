import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Smartphone } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { redeemPairingLink } from "@/lib/managed-children.functions";
import { managedChildErrorMessage } from "@/lib/managed-children";
import { tokenFromHash } from "@/lib/managed-pairing";
import { pairThisDevice, readParkedGuardianSession } from "@/lib/managed-session";

export const Route = createFileRoute("/pair")({
  head: () =>
    pageHead({
      path: "/pair",
      title: "Open your profile — BallaCity",
      description: "Open your BallaCity profile on this device.",
      noindex: true,
    }),
  ssr: false,
  component: PairPage,
});

/**
 * Where a guardian's pairing link lands. Nothing happens until the child taps
 * "Open my profile": a link preview or a stray tap must not spend it. The
 * token is read from the URL fragment (never sent to a server) and then
 * removed from the address bar.
 */
function PairPage() {
  const redeem = useServerFn(redeemPairingLink);
  const [token, setToken] = useState<string | null>(null);
  // The fragment is only readable in the browser, so say nothing about the
  // link until it has been read — a good link must not flash "can't be used".
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read once and remembered: React runs effects twice in development, and the
  // second run would find the token already gone from the address bar.
  const fragmentToken = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (fragmentToken.current === undefined) {
      fragmentToken.current = tokenFromHash(window.location.hash);
      if (fragmentToken.current) window.history.replaceState(null, "", window.location.pathname);
    }
    setToken(fragmentToken.current);
    setRead(true);
  }, []);

  const open = async () => {
    if (!token || busy) return;
    if (readParkedGuardianSession()) {
      setError("This device is switched into a child's profile. Switch back to your own first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { tokenHash } = await redeem({ data: { token } });
      await pairThisDevice(tokenHash);
    } catch (e) {
      setToken(null);
      setBusy(false);
      setError(managedChildErrorMessage(e));
    }
  };

  const hasLink = token !== null;
  if (!read) return <main className="min-h-dvh" aria-busy="true" />;
  return (
    <main className="page-shell grid min-h-dvh place-items-center py-10">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-surface-2">
          <Smartphone className="h-6 w-6" aria-hidden />
        </div>
        {hasLink ? (
          <>
            <h1 className="font-display text-xl font-bold">Open your BallaCity profile</h1>
            <p className="text-sm text-muted-foreground">
              Your parent set this up for you. Tap below to sign in on this device — no password
              needed.
            </p>
            <Button className="w-full" disabled={busy} onClick={() => void open()}>
              {busy ? "Opening…" : "Open my profile"}
            </Button>
          </>
        ) : (
          <>
            <h1 className="font-display text-xl font-bold">This link can&apos;t be used</h1>
            <p className="text-sm text-muted-foreground" role="alert">
              {error ?? "This link has expired or was already used. Ask your parent for a new one."}
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/">Go to BallaCity</Link>
            </Button>
          </>
        )}
        {hasLink && error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
