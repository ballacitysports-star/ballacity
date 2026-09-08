import { cn } from "@/lib/utils";

/**
 * The standard page heading: title, optional supporting line, optional
 * actions, plus an optional leading slot for a back button or avatar.
 *
 * The layout is the part worth sharing. Title and actions sit on one row from
 * `sm` up, but stack on a phone — putting a title and a button on one row at
 * 320px is what pushes buttons off-screen and truncates headings. Stacking
 * also lets actions go full-width on mobile, which is the easier tap target.
 *
 * `text-balance` and `break-words` between them stop a long team or player
 * name from either overflowing its container or laddering down one word per
 * line.
 */

export type PageHeaderProps = {
  title: React.ReactNode;
  /** One supporting line under the title. */
  description?: React.ReactNode;
  /** Buttons or links. Full-width on mobile, inline from `sm` up. */
  actions?: React.ReactNode;
  /** Back button, avatar, or icon shown before the title. */
  leading?: React.ReactNode;
  className?: string;
  /** Render the title as something other than an h1 for a nested heading. */
  as?: "h1" | "h2";
};

export function PageHeader({
  title,
  description,
  actions,
  leading,
  className,
  as: Heading = "h1",
}: PageHeaderProps) {
  return (
    <div className={cn("mb-5 flex flex-col gap-3 sm:flex-row sm:items-start", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          {/* The same `page-title` utility the hand-written <h1>s use, so the
              component and a plain heading cannot drift apart. */}
          <Heading className="page-title">{title}</Heading>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground text-pretty">{description}</p>
          ) : null}
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
