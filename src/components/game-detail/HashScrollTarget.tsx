import { useEffect, useRef, type ReactNode } from "react";

/**
 * A block a link can open at with `#<id>` (WP 5.6: the host's attendance prompt opens the roster's Attendance block,
 * `/games/<id>?tab=overview#attendance`). The block appears only once the game page has loaded its roster, after the
 * browser's own jump to the hash has passed, so it scrolls itself into view when it first appears and the URL names it.
 */
export function HashScrollTarget({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== `#${id}`) return;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [id]);
  return (
    <div id={id} ref={ref} className={className}>
      {children}
    </div>
  );
}
