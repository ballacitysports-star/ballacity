import { ChevronRight } from "lucide-react";
import { gameCardCueLabel } from "@/lib/game-cta-copy";

/** The card is one link; this row says what tapping it opens. It is not a second button. */
export function GameCardCue({
  inFlow,
  locked,
  parentMode,
}: {
  inFlow: boolean;
  locked: boolean;
  parentMode: boolean;
}) {
  return (
    <span
      className="mt-0.5 inline-flex items-center justify-end gap-0.5 text-xs font-bold text-lime"
      data-testid="game-card-cue"
    >
      {gameCardCueLabel({ inFlow, locked, parentMode })}
      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
    </span>
  );
}
