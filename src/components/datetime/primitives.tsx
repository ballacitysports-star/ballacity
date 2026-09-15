/** Shared visual atoms for every date & time control in the app. */

export const dtInputCls =
  "rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-lime [color-scheme:dark]";

export function DtChip({
  active,
  onClick,
  children,
  ariaLabel,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={!!active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-40 ${
        active
          ? "border-lime bg-lime text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-lime/60"
      }`}
    >
      {children}
    </button>
  );
}

export function DtLabel({ children }: { children: React.ReactNode }) {
  return <span className="section-eyebrow text-muted-foreground">{children}</span>;
}

export function DtSummary({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <p
      className={`text-[11px] ${ok === false ? "font-semibold text-coral" : "text-muted-foreground"}`}
    >
      {children}
    </p>
  );
}
