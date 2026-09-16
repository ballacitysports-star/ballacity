import { Link, useLocation } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useMyChildStatus } from "@/lib/child-safety";

const HIDDEN_PREFIXES = [
  "/onboarding",
  "/parent",
  "/safety",
  "/privacy",
  "/terms",
  "/community-guidelines",
  "/account/legal",
  "/contact",
  "/auth",
];

/**
 * A child account without approved guardian consent gets LIMITED, browse-only
 * access: it can look around the app, but every write the database cares
 * about (joining/hosting games, messaging, comments, video upload, …) is
 * refused by the `child_features_locked` triggers regardless of what this
 * component does. This banner is the friendly explanation, not the security
 * boundary — the DB enforces the real one, and the individual action buttons
 * (see `useMyChildStatus().can(...)`) reflect it in the UI too.
 */
export function ChildConsentGate() {
  const { status, consentBlocked, state, isLoading, policy } = useMyChildStatus();
  const location = useLocation();

  if (isLoading || !status || !consentBlocked) return null;
  if (HIDDEN_PREFIXES.some((p) => location.pathname.startsWith(p))) return null;

  const revoked = state === "PARENTAL_CONSENT_REVOKED";
  const pending = state === "PARENTAL_CONSENT_PENDING";

  return (
    <div className="sticky top-0 z-40 border-b border-border bg-surface/95 px-4 py-2.5 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-2.5 text-sm">
        <ShieldAlert className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 flex-1 text-muted-foreground">
          <span className="font-semibold text-foreground">
            {revoked
              ? "Your Guardian turned this account off."
              : pending
                ? "Waiting for your Guardian."
                : "Your Guardian needs to approve this account."}
          </span>{" "}
          {revoked
            ? "Games, messages, videos and comments stay off until they approve again."
            : pending
              ? "Games, messages, videos and comments stay off until they confirm."
              : `Because you're under ${policy.parentalConsentMaxAge + 1}, games, messages, videos and comments stay off until they do. You can still look around.`}
        </p>
        <Link
          to="/onboarding/child"
          className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
        >
          {pending ? "Check status" : "Start approval"}
        </Link>
      </div>
    </div>
  );
}
