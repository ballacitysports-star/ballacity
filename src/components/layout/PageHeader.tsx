import { cn } from "@/lib/utils";
import { BackButton } from "@/components/layout/BackButton";

/**
 * The standard page heading: an optional kicker, the title, one supporting
 * line, and optional actions — plus an optional back control or leading slot.
 *
 * It renders the shared `page-eyebrow` / `page-title` / `page-subtitle`
 * utilities rather than its own type styles, so a route that hand-rolls its
 * markup and a route that uses this component produce the same hierarchy.
 *
 * The layout is the part worth sharing. Title and actions sit on one row from
 * `sm` up, but stack on a phone — putting a title and a button on one row at
 * 320px is what pushes buttons off-screen and truncates headings. Stacking also
 * lets actions go full-width on mobile, which is the easier tap target.
 */

export type PageHeaderProps = {
  title: React.ReactNode;
  /** One supporting line under the title. */
  description?: React.ReactNode;
  /** Small uppercase kicker above the title — a section or context label. */
  eyebrow?: React.ReactNode;
  /** Buttons or links. Full-width on mobile, inline from `sm` up. */
  actions?: React.ReactNode;
  /** Show the shared back control before the title. */
  back?: boolean;
  /** Where back goes when the page was opened cold. Implies `back`. */
  backTo?: string;
  /** Avatar, icon, or custom control shown before the title. */
  leading?: React.ReactNode;
  className?: string;
  /** Render the title as something other than an h1 for a nested heading. */
  as?: "h1" | "h2";
};

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  back,
  backTo,
  leading,
  className,
  as: Heading = "h1",
}: PageHeaderProps) {
  const showBack = back || typeof backTo === "string";
  return (
    <div className={cn("mb-5 flex flex-col gap-3 sm:flex-row sm:items-start", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {showBack ? <BackButton fallbackTo={backTo} className="-ml-2" /> : null}
        {leading}
        <div className="min-w-0 flex-1">
          {eyebrow ? <p className="page-eyebrow mb-1">{eyebrow}</p> : null}
          <Heading className="page-title">{title}</Heading>
          {description ? <p className="page-subtitle mt-1">{description}</p> : null}
        </div>
      </div>
      {actions ? (
        // `shrink-0` keeps the actions at their natural size so the title
        // absorbs the squeeze instead of the buttons.
        <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full [&>*]:max-sm:flex-1">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
