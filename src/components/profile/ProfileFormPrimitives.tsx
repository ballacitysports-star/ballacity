import * as React from "react";

export function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {right}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}

export function Input({
  value,
  onChange,
  ...rest
}: { value: string; onChange: (v: string) => void } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  return (
    <input
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-full border border-border bg-surface px-4 py-2 text-sm outline-none focus:border-lime"
    />
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className="w-full flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-semibold"
    >
      <span>{label}</span>
      <span
        className={`h-6 w-10 rounded-full p-0.5 transition-colors ${checked ? "bg-lime" : "bg-secondary"}`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-background transition-transform ${checked ? "translate-x-4" : ""}`}
        />
      </span>
    </button>
  );
}

/** Shared birthday validation so onboarding and edit-profile stay identical. */
export function validateBirthday(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Enter a valid date (YYYY-MM-DD)";
  const [y, m, day] = value.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  if (
    isNaN(d.getTime()) ||
    d.getFullYear() !== y ||
    d.getMonth() !== m - 1 ||
    d.getDate() !== day
  ) {
    return "Enter a valid date (e.g., 2005-06-15)";
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (d > today) return "Birthday cannot be in the future";
  return null;
}
