import * as React from "react";
import { validateAgeMinimum } from "@/lib/age-policy";

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
    <div className="block mb-3">
      <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Enter a valid date (MM/DD/YYYY)";
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
  // Every age is supported. Under-13 birthdays are valid and route into the
  // parental-consent flow (see src/lib/age-policy + src/lib/child-policy).
  return validateAgeMinimum(value);
}

/** Format free-typed digits as MM/DD/YYYY while the user types. */
export function formatBirthdayInput(raw: string): string {
  // Allow ISO typing (YYYY-MM-DD) to pass through untouched.
  if (/^\d{4}-\d{0,2}(-\d{0,2})?$/.test(raw)) return raw.slice(0, 10);
  const digits = raw.replace(/[^0-9]/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Convert a canonical YYYY-MM-DD value into the MM/DD/YYYY display form. */
export function birthdayToDisplay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

/**
 * Parse typed text into a canonical YYYY-MM-DD string.
 * Returns `complete: false` while the entry is still partial.
 */
export function parseBirthdayInput(text: string): { iso: string | null; complete: boolean } {
  const t = text.trim();
  if (!t) return { iso: "", complete: true };
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return { iso: `${iso[1]}-${iso[2]}-${iso[3]}`, complete: true };
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const mm = us[1].padStart(2, "0");
    const dd = us[2].padStart(2, "0");
    return { iso: `${us[3]}-${mm}-${dd}`, complete: true };
  }
  return { iso: null, complete: false };
}
