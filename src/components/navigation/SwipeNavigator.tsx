import { useCallback } from "react";
import { useLocation, useRouter } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useSwipeNavigation } from "@/hooks/use-swipe-navigation";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useAuth } from "@/hooks/use-auth";
import { isTabPath, tabsForMode, type SwipeIntent } from "@/lib/navigation-gestures";
import { useParentMode } from "@/hooks/use-parent-mode";

/**
 * Wraps the routed view so horizontal swipes navigate, the way Instagram and
 * the iOS back gesture behave:
 *
 *   - on a tab route, dragging sideways pages to the neighbouring tab;
 *   - on a detail route, dragging in from the left edge pops history.
 *
 * The content follows the finger while the drag is live so the gesture feels
 * attached rather than fired-and-forget, and springs back if released short of
 * the threshold. A drag that cannot go anywhere — the first tab dragged
 * further right, say — gets heavy resistance instead of moving freely, which
 * is how a native pager signals the end of the line.
 */

/** Past the threshold the page moves 1:1; a dead end drags at this fraction. */
const RESISTANCE = 0.28;

/** Spring used to settle back, or to carry the page out on a commit. */
const SETTLE = { type: "spring" as const, stiffness: 520, damping: 42, mass: 0.7 };

export function SwipeNavigator({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { pathname } = useLocation();
  const reducedMotion = useReducedMotion();
  const { user } = useAuth();
  const { isParentMode } = useParentMode();
  const tabs = tabsForMode(isParentMode);

  // Read fresh every render rather than memoised: the answer changes as the
  // user navigates, and the call is trivial.
  let canGoBack = false;
  try {
    canGoBack = router.history.canGoBack();
  } catch {
    canGoBack = false;
  }

  // Paging between tabs is only offered where the tab bar itself is: to a
  // signed-out visitor "/" is the marketing page, not the Home tab, and
  // swiping it would just bounce them into /auth. The back gesture stays on
  // for everyone, since popping history is safe whoever you are.
  const pageableTabs = !!user;

  const onCommit = useCallback(
    (intent: SwipeIntent) => {
      if (intent.kind === "back") {
        router.history.back();
      } else if (intent.kind === "tab") {
        router.navigate({ to: intent.to });
      }
    },
    [router],
  );

  const { state, handlers } = useSwipeNavigation({
    pathname,
    canGoBack,
    onCommit,
    tabsEnabled: pageableTabs,
    tabs,
    // With reduced motion the gesture still navigates, but nothing tracks the
    // finger — the drag is read on release and the route just changes.
    disabled: false,
  });

  // A drag with nowhere to go still gives feedback, just a stiff one.
  const offset = state.active ? (state.intent === "none" ? state.dx * RESISTANCE : state.dx) : 0;

  const onTab = isTabPath(pathname, tabs);

  return (
    <div
      className="relative min-h-dvh touch-pan-y"
      {...handlers}
      // The gesture is an enhancement over the existing links and back
      // buttons, which remain the accessible path, so this wrapper stays out
      // of the accessibility tree as an interactive element.
    >
      {/* Edge scrim: darkens the outgoing page as a back gesture progresses,
          matching the depth cue a native push/pop transition gives. */}
      {!onTab && state.active && state.intent === "back" && !reducedMotion && (
        <motion.div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-30 bg-black"
          initial={{ opacity: 0 }}
          animate={{
            opacity: Math.max(0, 0.28 - (offset / Math.max(1, window.innerWidth)) * 0.28),
          }}
          transition={{ duration: 0 }}
        />
      )}

      <motion.div
        animate={{ x: reducedMotion ? 0 : offset }}
        transition={state.active ? { duration: 0 } : SETTLE}
        style={{
          // Only promote to its own layer while a gesture is live; a permanent
          // transform would create a containing block and break `fixed`
          // descendants such as the bottom bar and any open sheet.
          willChange: state.active ? "transform" : undefined,
          boxShadow:
            state.active && state.intent === "back" ? "-12px 0 32px rgba(0,0,0,0.35)" : undefined,
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
