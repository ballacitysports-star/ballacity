import { useState } from "react";
import { ChevronDown, Lock, ShieldCheck } from "lucide-react";
import { reelPrivacyFor, type ReelPrivacyCohort } from "@/lib/reel-privacy";

export function ReelPrivacyPanel({
  cohort,
  familyPost,
}: {
  cohort: ReelPrivacyCohort;
  familyPost?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const info = reelPrivacyFor(cohort, { familyPost });
  return (
    <div className="mb-3 rounded-xl border border-border bg-surface p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span>
          <span className="inline-flex items-center gap-1.5 micro-label text-lime">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Reel privacy
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{info.summary}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs">
          {info.options.length > 0 && (
            <fieldset>
              <legend className="font-semibold">Who can view this reel?</legend>
              <ul className="mt-1.5 space-y-1.5">
                {info.options.map((o) => (
                  <li
                    key={o.label}
                    className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 ${
                      o.isDefault ? "border-lime/50 bg-lime/5" : "border-border"
                    }`}
                  >
                    <span>
                      {o.label}
                      <span className="ml-1.5 text-[11px] text-muted-foreground">— {o.note}</span>
                    </span>
                    {o.locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Guardian approval required" />}
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <p className="text-muted-foreground">{info.detail}</p>
          {info.guardianControlled && (
            <p className="text-muted-foreground">
              {familyPost
                ? "After upload, choose a team under “Who can watch.” You can change sharing or remove this reel anytime."
                : "Your guardian can change sharing or remove this reel anytime from the Parent Center."}
            </p>
          )}
          <a href="/youth-policy" className="inline-block font-semibold text-lime underline-offset-2 hover:underline">
            View Reel privacy policy
          </a>
        </div>
      )}
    </div>
  );
}
