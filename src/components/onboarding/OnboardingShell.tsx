import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one frame every account-setup step wears.
 *
 * Setup used to be a set of unrelated pages — different widths, different
 * title sizes, different button styling — so each step read as a new product.
 * This shell owns the frame only: the steps keep their own forms, validation
 * and navigation.
 *
 * `step`/`steps` are deliberately optional. Setup branches by account type, so
 * a total is only honest on the steps that everyone passes through in the same
 * order; where it isn't, the counter is left off rather than guessed at.
 */
export function OnboardingShell({
  title,
  description,
  step,
  steps,
  children,
  footer,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  step?: number;
  steps?: number;
  children: ReactNode;
  /** Tertiary links under the primary action — "Sign out", "Skip for now". */
  footer?: ReactNode;
  className?: string;
}) {
  const showProgress = typeof step === "number" && typeof steps === "number" && steps > 1;
  return (
    <div className={cn("min-h-dvh bg-background px-4 py-10", className)}>
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden />
            <span className="text-xs font-bold uppercase tracking-wide">Account setup</span>
          </div>
          {showProgress ? (
            <span className="shrink-0 text-xs font-semibold text-muted-foreground">
              Step {step} of {steps}
            </span>
          ) : null}
        </div>

        {showProgress ? (
          <div
            className="mt-3 flex gap-1.5"
            role="progressbar"
            aria-valuenow={step}
            aria-valuemin={1}
            aria-valuemax={steps}
            aria-label={`Step ${step} of ${steps}`}
          >
            {Array.from({ length: steps! }).map((_, i) => (
              <span
                key={i}
                className={cn("h-1 flex-1 rounded-full", i < step! ? "bg-lime" : "bg-secondary/60")}
              />
            ))}
          </div>
        ) : null}

        <h1 className="mt-4 font-display text-2xl font-bold text-balance">{title}</h1>
        {description ? (
          <p className="mt-2 text-sm text-muted-foreground text-pretty">{description}</p>
        ) : null}

        <div className="mt-6">{children}</div>

        {footer ? (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
