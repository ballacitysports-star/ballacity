import { useEffect, useRef, useState, type ReactNode } from "react";

interface InfiniteListProps<T> {
  items: T[];
  pageSize?: number;
  renderItem: (item: T, index: number) => ReactNode;
  keyFor: (item: T, index: number) => string;
  renderSkeleton?: () => ReactNode;
  emptyState?: ReactNode;
  className?: string;
  /** Reset paging when this value changes (e.g. tab / filter changes). */
  resetKey?: string | number;
}

/**
 * Instagram-style incremental reveal for card grids.
 * - IntersectionObserver auto-loads the next page as the sentinel enters view.
 * - Falls back to an explicit "Load more" button for accessibility.
 * - Renders skeletons briefly on load-more for smoothness.
 */
export function InfiniteList<T>({
  items,
  pageSize = 6,
  renderItem,
  keyFor,
  renderSkeleton,
  emptyState,
  className = "space-y-3",
  resetKey,
}: InfiniteListProps<T>) {
  const [visible, setVisible] = useState(pageSize);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset when items identity or resetKey changes.
  useEffect(() => {
    setVisible(pageSize);
  }, [pageSize, resetKey, items]);

  useEffect(() => {
    if (visible >= items.length) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLoadingMore(true);
          // Micro-delay so skeletons paint at least one frame — feels smoother.
          requestAnimationFrame(() => {
            setVisible((v) => Math.min(v + pageSize, items.length));
            requestAnimationFrame(() => setLoadingMore(false));
          });
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, items.length, pageSize]);

  if (items.length === 0) {
    return <>{emptyState}</>;
  }

  const shown = items.slice(0, visible);
  const remaining = items.length - visible;
  const nextBatch = Math.min(pageSize, remaining);

  return (
    <div className={className}>
      {shown.map((item, i) => (
        <div key={keyFor(item, i)}>{renderItem(item, i)}</div>
      ))}
      {loadingMore && renderSkeleton && (
        <>
          {Array.from({ length: nextBatch }).map((_, i) => (
            <div key={`sk-${visible}-${i}`}>{renderSkeleton()}</div>
          ))}
        </>
      )}
      {remaining > 0 && (
        <div ref={sentinelRef} className="flex flex-col items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => setVisible((v) => Math.min(v + pageSize, items.length))}
            className="rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-lime hover:border-lime"
          >
            Load {nextBatch} more
          </button>
          <span className="micro-label text-muted-foreground">
            Showing {visible} of {items.length}
          </span>
        </div>
      )}
    </div>
  );
}
