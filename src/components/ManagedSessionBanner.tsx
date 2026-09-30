import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { isManagedUser } from "@/lib/managed-children";
import { readParkedGuardianSession, switchBackToGuardian } from "@/lib/managed-session";

/**
 * Shown on every page while a guardian is acting as their managed child, so
 * it is never unclear whose account is doing what — and getting back is one
 * tap. Everything done here is done as the child, under the child's rules.
 *
 * In normal flow rather than sticky: several pages (BackHeader,
 * ChildConsentGate) already stick to the top, and a second sticky bar would
 * cover their back buttons. The profile switcher offers the same way back.
 */
export function ManagedSessionBanner() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!isManagedUser(user)) return null;

  const parked = readParkedGuardianSession();
  const childName =
    parked?.childName ??
    (typeof user?.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name
      : "your child");
  const guardianFirst = parked?.guardianName?.split(" ")[0] ?? null;

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
    >
      <span className="min-w-0 truncate">
        Managing {childName}&apos;s profile — you&apos;re acting as your child.
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void switchBackToGuardian();
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-foreground/15 px-3 py-1 font-bold hover:bg-primary-foreground/25 disabled:opacity-60"
      >
        <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
        {busy ? "Switching…" : guardianFirst ? `Back to ${guardianFirst}` : "Back to your account"}
      </button>
    </div>
  );
}
