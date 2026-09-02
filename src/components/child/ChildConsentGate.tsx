import { Link, useLocation } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useMyChildStatus } from "@/lib/child-safety";

const ALLOWED_PREFIXES = [
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
 * A child account with no approved guardian consent never sees the social app.
 * The database enforces the same rule (child_features_locked), so this overlay
 * is the friendly explanation rather than the security boundary.
 */
export function ChildConsentGate() {
  const { status, consentBlocked, state, isLoading } = useMyChildStatus();
  const location = useLocation();

  if (isLoading || !status || !consentBlocked) return null;
  if (ALLOWED_PREFIXES.some((p) => location.pathname.startsWith(p))) return null;

  const revoked = state === "PARENTAL_CONSENT_REVOKED";
  const pending = state === "PARENTAL_CONSENT_PENDING";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/95 p-5 backdrop-blur">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2 text-primary">
          <ShieldAlert className="h-5 w-5" aria-hidden />
          <span className="text-xs font-bold uppercase tracking-wide">Account needs approval</span>
        </div>
        <h1 className="mt-2 font-display text-xl font-bold">
          {revoked
            ? "A parent or guardian turned this account off"
            : pending
              ? "Waiting for your parent or guardian"
              : "OpenRun needs a parent or guardian to approve this account"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {revoked
            ? "Your parent or guardian withdrew their approval, so games, messages, videos and your profile are turned off. They can approve again from the Parent Center."
            : pending
              ? "We're waiting for them to open the approval link and confirm. Games, messages and videos stay off until they do."
              : "Because you're under 13, a parent or guardian has to approve your account before you can join games, message anyone, or share videos."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            to="/onboarding/child"
            className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
          >
            {pending ? "Check approval status" : "Start approval"}
          </Link>
          <Link
            to="/safety/children"
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
          >
            Child & teen safety
          </Link>
        </div>
      </div>
    </div>
  );
}
