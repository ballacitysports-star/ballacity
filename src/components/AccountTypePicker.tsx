import { ACCOUNT_TYPE_META, ACCOUNT_TYPES, type AccountType } from "@/lib/account-type";

export function AccountTypePicker({
  value,
  onChange,
  title = "How will you use OpenRun?",
  subtitle = "Pick the account type that fits you. This can't be changed later.",
}: {
  value: AccountType | null;
  onChange: (t: AccountType) => void;
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="font-display text-xl font-bold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
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
      </div>
    </div>
  );
}
