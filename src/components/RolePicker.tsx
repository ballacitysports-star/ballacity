import { useState } from "react";
import {
  ROLES,
  SETUPS,
  roleOfSetup,
  type RoleId,
  type RoleMeta,
  type SetupId,
} from "@/lib/account-type";

/**
 * The single question at sign-up and in onboarding: what are you here to do?
 *
 * Four roles. Player, Parent / Guardian and Facility / Gym each have one setup,
 * so tapping the card answers it. Team / Coach has two, so tapping it asks which
 * one — on this same screen, not on another — and `value` stays null until that
 * is answered.
 */
export function RolePicker({
  value,
  onChange,
  title = "Where do you want to start?",
  subtitle = "Pick what fits you now. You can add other profiles later and switch between them anytime.",
  /**
   * Off when the surrounding page already states the question — the setup
   * shell does, and two headings asking the same thing reads as a bug.
   */
  heading = true,
  /**
   * The Parent / Guardian card. Off where the member is known not to be an
   * adult, since everything it leads to needs one.
   */
  allowParent = true,
}: {
  value: SetupId | null;
  onChange: (setup: SetupId | null) => void;
  title?: string;
  subtitle?: string;
  heading?: boolean;
  allowParent?: boolean;
}) {
  // The role whose setups are being chosen between, before one has been chosen.
  const [asking, setAsking] = useState<RoleId | null>(null);
  const selected: RoleId | null = value ? roleOfSetup(value).id : asking;
  const roles = ROLES.filter((r) => !r.adultsOnly || allowParent);
  const open = roles.find((r) => r.id === selected && r.setups.length > 1) ?? null;

  const choose = (role: RoleMeta) => {
    if (role.setups.length === 1) {
      setAsking(null);
      onChange(role.setups[0]);
      return;
    }
    setAsking(role.id);
    // Keep an answer that already belongs to this role; otherwise wait for one.
    if (!(value && role.setups.includes(value))) onChange(null);
  };

  return (
    <div className="space-y-4">
      {heading ? (
        <div className="text-center">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        {roles.map((r) => {
          const isSelected = selected === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => choose(r)}
              className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition ${
                isSelected
                  ? "border-lime bg-lime/10 ring-2 ring-lime"
                  : "border-border bg-surface hover:border-foreground/30"
              }`}
              aria-pressed={isSelected}
            >
              <span className="text-3xl leading-none">{r.emoji}</span>
              <span className="text-sm font-bold">{r.label}</span>
              <span className="text-xs text-muted-foreground">{r.blurb}</span>
            </button>
          );
        })}
      </div>
      {open ? (
        <div
          role="group"
          aria-label={`${open.label}: which one?`}
          className="space-y-2 rounded-2xl border border-border bg-surface p-3"
        >
          <p className="text-xs font-semibold text-muted-foreground">
            Which one are you setting up?
          </p>
          <div className="grid grid-cols-2 gap-2">
            {open.setups.map((s) => {
              const meta = SETUPS[s];
              const isSelected = value === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => onChange(s)}
                  aria-pressed={isSelected}
                  className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? "border-lime bg-lime/10 ring-2 ring-lime"
                      : "border-border bg-background hover:border-foreground/30"
                  }`}
                >
                  <span className="text-sm font-bold">{meta.label}</span>
                  {meta.blurb ? (
                    <span className="text-xs text-muted-foreground">{meta.blurb}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
