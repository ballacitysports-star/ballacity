import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one empty state.
 *
 * Every empty surface in the app answers the same three questions: what is
 * empty, why it might be empty, and what to do next. Keeping that shape in one
 * component is what stops each list inventing its own "No results" line.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  /** A lucide icon element, e.g. <Users className="h-6 w-6" />. */
  icon?: ReactNode;
  title: ReactNode;
  /** Why the user is seeing this, in plain language. */
  description?: ReactNode;
  /** One action — the most useful next step. Optional. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-border bg-surface px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-secondary/60 text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <p className="font-semibold text-pretty">{title}</p>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground text-pretty">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
