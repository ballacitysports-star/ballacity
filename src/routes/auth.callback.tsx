import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { consumePostAuthRedirect } from "@/lib/auth-redirect";
import { waitForAuthSession } from "@/hooks/use-auth";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Signing in — OpenRun" }] }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const nav = useNavigate();
  const [message, setMessage] = useState("Finishing sign in…");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const next = consumePostAuthRedirect();
      const state = await waitForAuthSession();
      if (cancelled) return;

      if (state.user) {
        nav({ to: next, replace: true });
        return;
      }

      setMessage("We couldn't finish signing you in.");
      toast.error("Sign in did not complete. Please try again.");
      nav({ to: "/auth", replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [nav]);

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6 text-center">
      <div>
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        <h1 className="mt-5 font-display text-2xl font-bold text-foreground">{message}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Opening OpenRun…</p>
      </div>
    </div>
  );
}