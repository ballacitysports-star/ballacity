import { useCallback, useEffect, useRef, useState } from "react";

/** How close to the bottom (px) still counts as "reading the latest message". */
export const NEAR_BOTTOM_PX = 120;

export function isNearBottom(el: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
}

/**
 * Keeps a scrolling list pinned to its newest item, like a messaging app: when
 * the list grows (a message, an image finishing loading) or its box changes size
 * (the keyboard opening), it stays at the bottom, unless the reader has scrolled
 * up to read older messages. Returns a ref callback for the scrolling element,
 * and a function that pins it now (for the sender's own message).
 */
export function useStickToBottom(): {
  ref: (el: HTMLDivElement | null) => void;
  pinNow: () => void;
} {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);
  const elRef = useRef<HTMLDivElement | null>(null);

  const ref = useCallback((node: HTMLDivElement | null) => {
    elRef.current = node;
    setEl(node);
  }, []);

  const pinNow = useCallback(() => {
    nearBottom.current = true;
    const node = elRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);

  useEffect(() => {
    if (!el) return;
    const pinIfNear = () => {
      if (nearBottom.current) el.scrollTop = el.scrollHeight;
    };
    const onScroll = () => {
      nearBottom.current = isNearBottom(el);
    };
    nearBottom.current = true;
    pinIfNear();
    el.addEventListener("scroll", onScroll, { passive: true });
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(pinIfNear) : null;
    resize?.observe(el);
    const mutate = new MutationObserver(pinIfNear);
    mutate.observe(el, { childList: true, subtree: true });
    // Pictures change a bubble's height after it is added.
    const onLoad = () => pinIfNear();
    el.addEventListener("load", onLoad, true);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("load", onLoad, true);
      resize?.disconnect();
      mutate.disconnect();
    };
  }, [el]);

  return { ref, pinNow };
}
