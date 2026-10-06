import { AGE_GROUPS, normalizeAgeGroups, type AgeGroupId } from "@/lib/age-groups";

/** Multi-select chips for the age groups a coach works with. */
export function AgeGroupPicker({
  selected,
  onChange,
}: {
  selected: readonly string[];
  onChange: (next: AgeGroupId[]) => void;
}) {
  const current = normalizeAgeGroups(selected);
  return (
    <div className="flex flex-wrap gap-2">
      {AGE_GROUPS.map(({ id, label }) => {
        const active = current.includes(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() =>
              onChange(
                normalizeAgeGroups(active ? current.filter((x) => x !== id) : [...current, id]),
              )
            }
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? "border-lime bg-lime/10 text-lime"
                : "border-border bg-surface text-muted-foreground hover:border-lime/40"
            }`}
            aria-pressed={active}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
