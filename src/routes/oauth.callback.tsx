import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  establishSessionFromOAuthUrl,
  hasOAuthErrorInUrl,
  waitForAuthSession,
} from "@/lib/oauth-session";
import { consumePostAuthRedirect } from "@/lib/post-auth-redirect";

export const Route = createFileRoute("/oauth/callback")({
  head: () => ({ meta: [{ title: "Signing in — OpenRun" }] }),
  component: OAuthCallbackPage,
});

function OAuthCallbackPage() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const finish = async () => {
      if (hasOAuthErrorInUrl(window.location.href)) {
        if (!cancelled) setFailed(true);
        return;
      }

      const fromUrl = await establishSessionFromOAuthUrl();
      if (fromUrl.error) {
        if (!cancelled) setFailed(true);
        return;
      }

      const session = fromUrl.session ?? (await waitForAuthSession({ timeoutMs: 15_000 }));
      if (cancelled) return;

      if (session) {
        const returnPath = consumePostAuthRedirect("/profile");
        window.location.replace(returnPath);
        return;
      }

      if (!cancelled) setFailed(true);
    };

    void finish();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-5 text-center">
      <div className="max-w-sm">
        {!failed && (
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        )}
        <h1 className="mt-5 font-display text-2xl font-bold">Signing you in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {failed ? "We couldn't finish the sign-in. Please try again." : "One moment while OpenRun finishes connecting your account."}
        </p>
        {failed && (
          <Link
            to="/auth"
            className="mt-6 inline-flex rounded-full bg-lime-gradient px-5 py-3 text-sm font-bold text-primary-foreground"
          >
            Back to sign in
          </Link>
        )}
      </div>
    </div>
  );
}