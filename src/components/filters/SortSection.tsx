import { ChipRow, FilterSection } from "@/components/FilterSheet";

/**
 * Shared "Sort" block for every filter sheet in the app (Feed, Players,
 * Teams, Trainers). Keeps the label, hint, and chip styling identical so the
 * sort control reads the same wherever filters are opened.
 */
export type SortOption<T extends string> = { value: T; label: string };

export function SortSection<T extends string>({
  value,
  onChange,
  options,
  label = "Sort",
  hint,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<SortOption<T>>;
  label?: string;
  hint?: string;
}) {
  const active = options.find((o) => o.value === value);
  return (
    <FilterSection label={label} hint={hint ?? (active ? `By ${active.label.toLowerCase()}` : undefined)}>
      <ChipRow value={value} onChange={onChange} options={options} />
    </FilterSection>
  );
}

/** Small "Sorted by X" line shown above result lists. */
export function SortSummary<T extends string>({
  value,
  options,
}: {
  value: T;
  options: Array<SortOption<T>>;
}) {
  const active = options.find((o) => o.value === value);
  if (!active) return null;
  return <span className="text-xs text-muted-foreground">Sorted by {active.label.toLowerCase()}</span>;
}
