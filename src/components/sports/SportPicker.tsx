import { Check } from "lucide-react";
import { SPORTS, type Sport } from "@/lib/sample-data";
import { makePrimarySport, orderSportsByPriority } from "@/lib/sport-hubs";

/** Football covers flag football in the canonical list; say so on the card. */
const HINT: Partial<Record<Sport, string>> = { Football: "incl. flag" };

const CARDS = orderSportsByPriority(SPORTS);

/**
 * "What sports do you play or follow?" as a grid of selectable cards.
 *
 * Native checkboxes (visually hidden) give keyboard and screen-reader support:
 * Tab to move, Space to toggle, and the selected state is announced. The
 * selected look is a check mark plus a filled card, never colour alone.
 *
 * Choosing a sport only adds or removes its entry; existing levels and
 * positions on other sports are untouched. When more than one sport is
 * chosen, a second question picks the primary one (the first entry).
 */
export function SportPicker<T extends { name: Sport; level?: unknown; positions?: string[] }>({
  sports,
  onChange,
  confirmRemoveWithDetails = false,
}: {
  sports: T[];
  onChange: (next: T[]) => void;
  /**
   * Ask before unticking a sport that already has a level or positions saved,
   * since removing it discards them. Off in onboarding; on in Edit profile.
   */
  confirmRemoveWithDetails?: boolean;
}) {
  const selected = new Set(sports.map((s) => s.name));

  const toggle = (name: Sport) => {
    if (!selected.has(name)) {
      onChange([...sports, { name } as unknown as T]);
      return;
    }
    const entry = sports.find((s) => s.name === name);
    const hasDetails = !!entry && (!!entry.level || (entry.positions?.length ?? 0) > 0);
    if (
      confirmRemoveWithDetails &&
      hasDetails &&
      !window.confirm(`Remove ${name}? Its skill level and positions will be cleared.`)
    ) {
      return;
    }
    onChange(sports.filter((s) => s.name !== name));
  };

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="text-sm font-semibold">What sports do you play or follow?</legend>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick as many as you like. You can change this any time.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CARDS.map((s) => {
            const on = selected.has(s.name);
            return (
              <label
                key={s.name}
                className={`relative flex min-h-14 cursor-pointer items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold transition-colors focus-within:ring-2 focus-within:ring-ring ${
                  on
                    ? "border-lime bg-lime/15 text-foreground"
                    : "border-border bg-surface text-foreground hover:border-lime/40"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() => toggle(s.name)}
                />
                <span aria-hidden className="text-xl leading-none">
                  {s.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  {s.name}
                  {HINT[s.name] && (
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {HINT[s.name]}
                    </span>
                  )}
                </span>
                {on && <Check aria-hidden className="h-4 w-4 shrink-0 text-lime" />}
              </label>
            );
          })}
        </div>
      </fieldset>

      {sports.length > 1 && (
        <fieldset>
          <legend className="text-sm font-semibold">
            Which sport are you most interested in right now?
          </legend>
          <p className="mt-1 text-xs text-muted-foreground">
            We&apos;ll show it first. You can change it in your profile.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {sports.map((s) => {
              const primary = sports[0]?.name === s.name;
              return (
                <label
                  key={s.name}
                  className={`flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors focus-within:ring-2 focus-within:ring-ring ${
                    primary
                      ? "border-lime bg-lime text-primary-foreground"
                      : "border-border bg-surface hover:border-lime/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="primary-sport"
                    className="sr-only"
                    checked={primary}
                    onChange={() => onChange(makePrimarySport(sports, s.name))}
                  />
                  {s.name}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}
