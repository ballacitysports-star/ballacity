import { useState, type ReactNode } from "react";
import { ShareSheet } from "@/components/ShareSheet";
import { buildRecapShare, type RecapSummary } from "@/lib/recaps";

/** Opens the share sheet for a finished-game recap. Callers must not render it for family clips. */
export function RecapShareButton({
  recap,
  game,
  className,
  label,
  children,
}: {
  recap: RecapSummary | null;
  game: { id: string; title: string };
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} aria-label={label}>
        {children}
      </button>
      {open && (
        <ShareSheet
          content={buildRecapShare(recap, game, window.location.origin)}
          open
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
