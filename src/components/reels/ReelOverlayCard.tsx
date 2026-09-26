import type { ReelOverlayTheme } from "@/lib/reel-style";

/** How each overlay theme looks on screen (mirrors the wording rules the AI follows). */
const THEME_LOOK: Record<Exclude<ReelOverlayTheme, "none">, string> = {
  scoreboard:
    "left-3 max-w-[80%] rounded-md border-l-4 border-lime bg-black/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white enter-up",
  minimal:
    "left-3 top-3 max-w-[70%] text-sm font-medium lowercase tracking-wide text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] enter-fade",
  bold: "inset-x-3 top-[18%] text-center text-2xl font-black uppercase italic leading-none text-lime drop-shadow-[0_2px_0_rgba(0,0,0,0.85)] enter-pop",
  retro:
    "left-3 max-w-[80%] border-t-2 border-amber-300 bg-blue-950/90 px-3 py-1 font-serif text-xs text-amber-50 shadow-[3px_3px_0_rgba(0,0,0,0.6)] enter-up",
};

/**
 * One on-screen text card drawn over a reel, styled by the athlete's overlay
 * theme. Lower-third themes sit above the native video controls in the player.
 * Remount it (via `key`) to replay its entrance.
 */
export function ReelOverlayCard({
  theme,
  text,
  inPlayer = true,
}: {
  theme: ReelOverlayTheme;
  text: string;
  /** In the player, lower-third cards clear the native control bar. */
  inPlayer?: boolean;
}) {
  if (theme === "none" || !text) return null;
  const lowerThird = theme === "scoreboard" || theme === "retro";
  return (
    <div
      className={`pointer-events-none absolute z-10 break-words ${THEME_LOOK[theme]} ${
        lowerThird ? (inPlayer ? "bottom-14" : "bottom-3") : ""
      }`}
    >
      {text}
    </div>
  );
}
