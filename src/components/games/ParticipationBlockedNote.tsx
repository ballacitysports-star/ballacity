import { Lock } from "lucide-react";

/**
 * Says why the join button is disabled when a parent or guardian has not approved this
 * account. The button is disabled, so its tap handler's toast can never show this text.
 * The decision and its reason come from the existing consent check; this only displays it.
 */
export function ParticipationBlockedNote({
  reason,
  className = "",
}: {
  reason?: string | null;
  className?: string;
}) {
  const text = reason?.trim() || "A parent or guardian must approve this account first.";
  return (
    <p
      className={`flex items-start gap-1.5 text-[11px] font-medium text-muted-foreground ${className}`}
      role="status"
    >
      <Lock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="font-semibold text-foreground">Can’t join yet:</span> {text}
      </span>
    </p>
  );
}
