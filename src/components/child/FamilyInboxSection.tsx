import { Link } from "@tanstack/react-router";
import { ChevronRight, ShieldAlert } from "lucide-react";
import { useParentMode } from "@/hooks/use-parent-mode";
import { describePending } from "@/lib/family-pending";
import { useFamilyPending } from "@/lib/use-family-pending";

/**
 * Top of the Inbox for a parent account: what is waiting on them, with one way
 * into the Parent Center. Renders nothing for anyone else, or when nothing waits.
 */
export function FamilyInboxSection({ className = "" }: { className?: string }) {
  const { isParentMode } = useParentMode();
  return isParentMode ? <WaitingOnYou className={className} /> : null;
}

function WaitingOnYou({ className }: { className: string }) {
  const { pending } = useFamilyPending();
  if (pending.total === 0) return null;
  return (
    <section aria-label="Family" className={className}>
      <Link
        to="/parent"
        className="flex min-h-11 items-center gap-3 rounded-2xl border border-coral/40 bg-coral/10 p-4"
      >
        <ShieldAlert className="h-5 w-5 shrink-0 text-coral" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">Waiting on you</span>
          <span className="block text-sm text-muted-foreground">{describePending(pending)}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </section>
  );
}
