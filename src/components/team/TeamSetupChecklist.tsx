import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ChevronRight, X } from "lucide-react";
import type { TeamSetupStep } from "@/lib/team-setup";

const dismissKey = (teamId: string) => `ballacity:team-setup-dismissed:${teamId}`;

function readDismissed(teamId: string): boolean {
  try {
    return localStorage.getItem(dismissKey(teamId)) === "1";
  } catch {
    return false;
  }
}

/**
 * Setup checklist on a team's own profile: logo, cover, bio, first game,
 * invite players, with progress. Disappears once everything is done, and can
 * be hidden (remembered per team on this device).
 */
export function TeamSetupChecklist({
  teamId,
  steps,
  editTo,
  onInvite,
}: {
  teamId: string;
  steps: TeamSetupStep[];
  /** Where logo, cover and bio are edited. */
  editTo: { to: string; params: Record<string, string | undefined> };
  onInvite: () => void;
}) {
  const [dismissed, setDismissed] = useState(() => readDismissed(teamId));
  const done = steps.filter((s) => s.done).length;
  if (dismissed || done === steps.length) return null;

  const hide = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey(teamId), "1");
    } catch {
      /* storage unavailable: hidden for this visit only */
    }
  };

  const rowClass =
    "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-surface-2";

  return (
    <section
      aria-label="Team setup"
      className="mt-5 rounded-2xl border border-border bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold">Finish setting up your team</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {done} of {steps.length} done
          </p>
        </div>
        <button
          type="button"
          onClick={hide}
          aria-label="Hide setup checklist"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-label="Team setup progress"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
      >
        <div
          className="h-full rounded-full bg-lime-gradient transition-all"
          style={{ width: `${Math.round((done / steps.length) * 100)}%` }}
        />
      </div>
      <ul className="mt-3 space-y-0.5">
        {steps.map((step) => {
          const content = (
            <>
              <span
                aria-hidden
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${
                  step.done
                    ? "border-lime bg-lime text-primary-foreground"
                    : "border-border text-transparent"
                }`}
              >
                <Check className="h-3.5 w-3.5" />
              </span>
              <span
                className={`min-w-0 flex-1 ${step.done ? "text-muted-foreground line-through" : "font-medium"}`}
              >
                {step.label}
              </span>
              {!step.done && <ChevronRight aria-hidden className="h-4 w-4 text-muted-foreground" />}
              <span className="sr-only">{step.done ? "(done)" : "(to do)"}</span>
            </>
          );
          if (step.done) {
            return (
              <li key={step.id} className={rowClass.replace("hover:bg-surface-2", "")}>
                {content}
              </li>
            );
          }
          return (
            <li key={step.id}>
              {step.id === "invite" ? (
                <button type="button" onClick={onInvite} className={rowClass}>
                  {content}
                </button>
              ) : step.id === "game" ? (
                <Link to="/create" className={rowClass}>
                  {content}
                </Link>
              ) : (
                <Link to={editTo.to} params={editTo.params as never} className={rowClass}>
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
