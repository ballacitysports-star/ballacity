import { useEffect, useState } from "react";

export type ViewportBox = {
  /** Height of the part of the screen not covered by the keyboard. */
  height: number;
  /** How far the visible part has been scrolled down from the top of the page. */
  offsetTop: number;
  /** True while a keyboard is covering a good part of the screen. */
  keyboardOpen: boolean;
};

/**
 * The visible area of the screen. On a phone the layout viewport does not shrink
 * when the keyboard opens, so a screen sized by `100dvh` ends up with its
 * message box hidden or floating above a gap. Sizing a chat to this instead
 * keeps the message box on top of the keyboard. `null` until measured, and on
 * browsers without the API.
 */
export function useVisualViewport(): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(null);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const read = () =>
      setBox({
        height: Math.round(vv.height),
        offsetTop: Math.round(vv.offsetTop),
        keyboardOpen: window.innerHeight - vv.height > 120,
      });
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, []);
  return box;
}
