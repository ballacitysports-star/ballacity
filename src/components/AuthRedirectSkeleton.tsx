import { Logo } from "@/components/Logo";
import { Skeleton } from "@/components/ui/skeleton";

interface AuthRedirectSkeletonProps {
  label?: string;
}

/**
 * Full-screen placeholder shown while an authenticated user is being
 * redirected from `/` back to their last-visited page. Prevents the
 * marketing landing from flashing during the redirect frame.
 */
export function AuthRedirectSkeleton({
  label = "Taking you back to where you were…",
}: AuthRedirectSkeletonProps) {
  return (
    <div className="min-h-dvh bg-background" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>

      {/* Top-bar skeleton to mirror the app chrome */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Logo />
          <Skeleton className="h-9 w-24 rounded-full" />
        </div>
      </header>

      <div className="mx-auto flex max-w-md flex-col items-center gap-6 px-5 pt-24">
        <div className="w-full space-y-3">
          <Skeleton className="h-7 w-3/4 rounded-lg" />
          <Skeleton className="h-4 w-full rounded-md" />
          <Skeleton className="h-4 w-5/6 rounded-md" />
        </div>
        <Skeleton className="h-12 w-full rounded-full" />

        <div className="mt-6 flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    </div>
  );
}
