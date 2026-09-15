import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

/**
 * The app's one back control.
 *
 * It pops history when there is history to pop — the way the platform back
 * gesture behaves — and only falls back to a route when the page was opened
 * cold (a shared link, a PWA launch, a refresh). Hardcoding `to="/"` instead is
 * what left readers stranded: on a signed-in account "/" bounces through the
 * gate and the page they came from is unreachable.
 *
 * Both headers render this, so the sticky bar on a detail page and the inline
 * header on a settings page behave identically.
 */
export function BackButton({
  fallbackTo,
  className,
  label = "Back",
}: {
  /** Where to go when there is no history to pop. */
  fallbackTo?: string;
  className?: string;
  label?: string;
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
    <button
      type="button"
      onClick={goBack}
      aria-label={label}
      className={cn(
        // 40px is the smallest square that still clears the 44px tap target
        // once the header's own padding is counted.
        "grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors hover:bg-surface active:scale-95",
        className,
      )}
    >
      <ArrowLeft className="h-5 w-5" aria-hidden />
    </button>
  );
}
