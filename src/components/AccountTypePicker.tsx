import {
  ACCOUNT_TYPE_META,
  ACCOUNT_TYPES,
  MANAGER_META,
  type StartingPoint,
} from "@/lib/account-type";

export function AccountTypePicker({
  value,
  onChange,
  title = "Where do you want to start?",
  subtitle = "Pick what fits you now. You can add team, trainer, and gym profiles later and switch between them anytime.",
  /**
   * Off when the surrounding page already states the question — the setup
   * shell does, and two headings asking the same thing reads as a bug.
   */
  heading = true,
  /**
   * The Parent / Guardian / Owner tile. Off where the member is known not to
   * be an adult, since everything it leads to needs one.
   */
  allowManager = true,
}: {
  value: StartingPoint | null;
  onChange: (t: StartingPoint) => void;
  title?: string;
  subtitle?: string;
  heading?: boolean;
  allowManager?: boolean;
}) {
  return (
    <div className="space-y-4">
      {heading ? (
        <div className="text-center">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        {ACCOUNT_TYPES.map((t) => {
          const meta = ACCOUNT_TYPE_META[t];
          const selected = value === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => onChange(t)}
              className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition ${
                selected
                  ? "border-lime bg-lime/10 ring-2 ring-lime"
                  : "border-border bg-surface hover:border-foreground/30"
              }`}
              aria-pressed={selected}
            >
              <span className="text-3xl leading-none">{meta.emoji}</span>
              <span className="text-sm font-bold">{meta.label}</span>
              <span className="text-xs text-muted-foreground">{meta.blurb}</span>
            </button>
          );
        })}
        {allowManager ? (
          <button
            type="button"
            onClick={() => onChange("manager")}
            className={`col-span-2 flex items-center gap-3 rounded-2xl border p-4 text-left transition ${
              value === "manager"
                ? "border-lime bg-lime/10 ring-2 ring-lime"
                : "border-border bg-surface hover:border-foreground/30"
            }`}
            aria-pressed={value === "manager"}
          >
            <span className="text-3xl leading-none">{MANAGER_META.emoji}</span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-sm font-bold">{MANAGER_META.label}</span>
              <span className="text-xs text-muted-foreground">{MANAGER_META.blurb}</span>
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
