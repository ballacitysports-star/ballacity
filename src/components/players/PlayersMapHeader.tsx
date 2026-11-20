/**
 * The header over Find Players' map. WP 4.1: the layout switch moved into the filter sheet, so the map has its own
 * one-tap way back to the list.
 */
export function PlayersMapHeader({ onShowList }: { onShowList: () => void }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="section-eyebrow text-muted-foreground">Map view</h2>
      <button
        type="button"
        onClick={onShowList}
        className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-sm font-semibold"
      >
        Show list
      </button>
    </div>
  );
}
