/**
 * YouTube channel-style tab bar: horizontally scrollable text labels with a
 * 2px underline marking the active tab. No icons, no pills.
 */
export type ChannelTab<T extends string> = { k: T; label: string; count?: number };

export function ChannelTabs<T extends string>({
  tabs,
  value,
  onChange,
  className = "",
}: {
  tabs: ChannelTab<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      className={`sticky top-0 z-10 -mx-4 border-b border-border bg-background/95 backdrop-blur ${className}`}
      role="tablist"
      aria-label="Profile sections"
    >
      <div className="scrollbar-hide flex gap-1 overflow-x-auto px-4">
        {tabs.map((t) => {
          const active = value === t.k;
          return (
            <button
              key={t.k}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.k)}
              className={`relative shrink-0 px-3 py-3 text-sm font-medium transition-colors ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="whitespace-nowrap">
                {t.label}
                {t.count ? (
                  <span className="ml-1.5 text-xs text-muted-foreground">{t.count}</span>
                ) : null}
              </span>
              {active && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-foreground" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
