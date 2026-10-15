/**
 * "Reel privacy": a compact, expandable panel on the Reels page that says who can watch
 * this account's reels, by the account's age. Collapsed it is one line. It only explains
 * the rules: the database enforces them, and a player can never widen them from here.
 */

import { Link } from "@tanstack/react-router";
import { Lock, ShieldCheck } from "lucide-react";
import { useMyCohort } from "@/lib/youth-features";
import { REEL_PRIVACY_PATH, TEEN_REEL_OPTIONS, TEEN_RESTRICTION, bandCopyFor } from "@/lib/reel-privacy";

export function ReelPrivacyPanel({ className = "" }: { className?: string }) {
  const { cohort } = useMyCohort();
  const copy = bandCopyFor(cohort);
  if (!copy) return null;
  const teen = copy.band === "teen_13_15";

  return (
    <details className={`group ${className}`}>
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-xs">
        <span className="flex min-w-0 items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-lime" aria-hidden />
          <span className="min-w-0">
            <span className="font-semibold">Reel privacy</span>
            <span className="block text-muted-foreground">{copy.summary}</span>
          </span>
        </span>
        <span className="shrink-0 text-[10px] font-semibold text-lime group-open:hidden">Details</span>
      </summary>

      <div className="mt-2 rounded-xl border border-border bg-surface p-4 text-xs">
        <p className="font-semibold">Who can watch</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
          {copy.audiences.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>

        {teen && (
          <fieldset className="mt-3" aria-label="Reel visibility">
            <legend className="font-semibold">Each reel</legend>
            <div className="mt-1 grid gap-1.5">
              {TEEN_REEL_OPTIONS.map((o) => {
                const locked = o.value === "team";
                return (
                  <div
                    key={o.value}
                    className={`rounded-lg border px-3 py-2 ${
                      o.value === "guardian" ? "border-primary bg-primary/10" : "border-border bg-background/60"
                    }`}
                    aria-disabled={locked}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
                      {o.label}
                      {o.value === "guardian" && (
                        <span className="rounded-full bg-primary/20 px-1.5 text-[10px] font-bold text-primary">Default</span>
                      )}
                    </span>
                    <span className="block text-muted-foreground">{o.hint}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 font-semibold">{TEEN_RESTRICTION}</p>
          </fieldset>
        )}

        {copy.never.length > 0 && (
          <p className="mt-3 text-muted-foreground">
            <span className="font-semibold text-foreground">Never: </span>
            {copy.never.join(", ")}.
          </p>
        )}

        <Link to={REEL_PRIVACY_PATH} className="mt-3 inline-block font-semibold text-primary underline">
          Read the full Reel privacy policy
        </Link>
      </div>
    </details>
  );
}
