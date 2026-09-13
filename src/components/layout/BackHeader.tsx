import { cn } from "@/lib/utils";
import { BackButton } from "@/components/layout/BackButton";

/**
 * The one sticky top bar every non-tab page wears.
 *
 * The back control itself lives in <BackButton>, shared with <PageHeader>, so
 * the two headers cannot drift on what "back" means.
 */
export function BackHeader({
  title,
  /** Where to go when there is no history to pop. */
  fallbackTo,
  actions,
  className,
}: {
  title: React.ReactNode;
  fallbackTo?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/95 px-2 py-2.5 backdrop-blur-xl",
        className,
      )}
    >
      <BackButton fallbackTo={fallbackTo} />
      <span className="bar-title min-w-0 flex-1 truncate">{title}</span>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
