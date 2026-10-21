import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";

/**
 * The shared layout for what a signed-out visitor sees of a game or a team: a
 * slim header with Sign in, the public facts, and one call to action that
 * returns them to the same page after they sign up.
 */
export function PublicPreviewFrame({
  next,
  ctaLabel,
  children,
}: {
  /** Same-origin path (with query) to come back to after sign-up or sign-in. */
  next: string;
  ctaLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="page-shell-narrow flex items-center justify-between py-3">
          <Logo />
          <Link
            to="/auth"
            search={{ next }}
            className="rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-semibold text-foreground transition-colors hover:border-lime/50 hover:text-lime"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="page-shell-narrow space-y-6 py-8">
        {children}

        <div className="space-y-3">
          <Link
            to="/auth"
            search={{ next, mode: "signup" }}
            className="flex w-full items-center justify-center rounded-2xl bg-lime-gradient py-3 text-sm font-bold text-primary-foreground glow-lime"
          >
            {ctaLabel}
          </Link>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/auth" search={{ next }} className="font-semibold text-lime underline">
              Sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
