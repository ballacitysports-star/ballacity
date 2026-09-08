import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

/**
 * The one sticky top bar every non-tab page wears.
 *
 * The back control pops history when there is history to pop — the way the
 * platform back gesture behaves — and only falls back to a route when the page
 * was opened cold (a shared link, a PWA launch, a refresh). Hardcoding
 * `to="/"` instead is what left readers stranded: on a signed-in account "/"
 * bounces through the gate and the page they came from is unreachable.
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
  const router = useRouter();
  const { user } = useAuth();

  const goBack = useCallback(() => {
    let canGoBack = false;
    try {
      canGoBack = router.history.canGoBack();
    } catch {
      canGoBack = false;
    }
    if (canGoBack) {
      router.history.back();
      return;
    }
    router.navigate({ to: fallbackTo ?? (user ? "/feed" : "/"), replace: true } as never);
  }, [router, fallbackTo, user]);

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/95 px-2 py-2.5 backdrop-blur-xl",
        className,
      )}
    >
      <button
        type="button"
        onClick={goBack}
        aria-label="Back"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors hover:bg-surface active:scale-95"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden />
      </button>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
