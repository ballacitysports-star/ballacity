import { useEffect, useState } from "react";

/**
 * Whether the viewer asked for reduced motion.
 *
 * styles.css already drops the CSS entrance animations under this preference;
 * this is the same signal for behaviour that only JavaScript can reach, like
 * whether a swipe animates across or cuts straight to the destination.
 *
 * Starts false so the server and the first client render agree, then corrects
 * on mount — the preference cannot be known during SSR.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
