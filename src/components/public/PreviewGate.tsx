import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { readStoredSupabaseSession } from "@/lib/authgate-log";
import type { PreviewTab } from "@/lib/preview-samples";
import { LoadingState } from "@/components/ui/loading-state";
import { SignedOutPreview } from "./SignedOutPreview";

/** How long a stored session may take to sign in before the preview is shown. */
const SESSION_GRACE_MS = 4000;

/**
 * Renders a tab's real page for a signed-in member and a blurred sample preview
 * for everyone else.
 *
 * The real page is a child that is only mounted once there is a user, so none of
 * its hooks, queries or server calls run for a signed-out visitor. That is what
 * keeps member data out of the preview; the blur is only presentation.
 *
 * A browser that still holds a saved session is given a moment to finish signing
 * in before the preview is chosen, so a member opening the app never sees a
 * flash of the sign-up prompt.
 */
export function PreviewGate({ tab, children }: { tab: PreviewTab; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [waitingForSession, setWaitingForSession] = useState(() => !!readStoredSupabaseSession());

  useEffect(() => {
    if (!waitingForSession) return;
    const timer = window.setTimeout(() => setWaitingForSession(false), SESSION_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [waitingForSession]);

  if (user) return <>{children}</>;
  if (loading || waitingForSession) return <LoadingState label="Loading…" className="py-24" />;
  return <SignedOutPreview tab={tab} next={location.href} />;
}
