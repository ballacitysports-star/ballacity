import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "muted" | "danger";

export interface PrimaryCTAProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  icon?: ReactNode;
}

/**
 * Shared primary call-to-action used across the core join flow
 * (Discover card, game details sticky bar, pay submit). Standardizes
 * height, radius, and state colors while preserving accessible labels.
 * Existing e2e specs match on the button label text, so children must
 * still render the human-readable label unchanged.
 */
export const PrimaryCTA = forwardRef<HTMLButtonElement, PrimaryCTAProps>(function PrimaryCTA(
  { variant = "primary", loading, icon, children, className = "", disabled, ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  const base =
    "inline-flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed";
  const styles: Record<Variant, string> = {
    primary: "bg-lime-gradient text-primary-foreground glow-lime",
    secondary: "bg-lime/15 border border-lime/40 text-lime",
    muted: "border border-border bg-surface text-muted-foreground",
    danger: "bg-coral/15 border border-coral/40 text-coral",
  };
  return (
    <button
      ref={ref}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      className={`${base} ${styles[variant]} ${className}`}
      {...rest}
    >
      {icon}
      {loading ? "Working…" : children}
    </button>
  );
});
