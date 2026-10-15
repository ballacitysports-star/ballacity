import { AlertTriangle, ChevronDown, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  gamePolicyLines,
  gamePolicyTeaser,
  HOST_ACK_DISCLAIMER,
  type GamePolicy,
} from "@/lib/game-policy";
import { LegalReviewTag } from "@/components/legal/LegalReviewTag";

/**
 * Participant-facing game policy block. Critical lines (payment, approval,
 * cancellation, refunds) are always visible — never collapsed behind a toggle.
 */
export function GamePolicySummary({
  policy,
  className = "",
  defaultOpen = false,
}: {
  policy: GamePolicy;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const lines = gamePolicyLines(policy);
  const critical = lines.filter((l) => l.critical);
  const rest = lines.filter((l) => !l.critical);

  return (
    <section
      aria-label="Game policies"
      className={`rounded-2xl border border-border bg-surface px-4 py-3 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldQuestion className="h-4 w-4 text-lime" aria-hidden /> Before you join
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{gamePolicyTeaser(policy)}</p>
        </div>
      </div>

      <dl className="mt-3 space-y-2">
        {critical.map((l) => (
          <div key={l.id} className="rounded-xl bg-background/60 px-3 py-2">
            <dt className="micro-label text-lime">{l.label}</dt>
            <dd className="mt-0.5 text-[12px] leading-relaxed">{l.value}</dd>
          </div>
        ))}
      </dl>

      {rest.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-2 flex w-full items-center justify-between rounded-xl border border-border px-3 py-2 text-[12px] font-semibold"
          >
            {open ? "Hide game details" : `Game rules & limits (${rest.length})`}
            <ChevronDown
              className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          {open && (
            <dl className="mt-2 space-y-2">
              {rest.map((l) => (
                <div key={l.id} className="rounded-xl bg-background/60 px-3 py-2">
                  <dt className="micro-label text-muted-foreground">
                    {l.label}
                  </dt>
                  <dd className="mt-0.5 whitespace-pre-line text-[12px] leading-relaxed">
                    {l.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}

      <p className="mt-3 flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          <LegalReviewTag area="safetyAcknowledgments" />
          {HOST_ACK_DISCLAIMER}{" "}
          <Link to="/safety" className="text-lime underline">
            Safety Center
          </Link>
        </span>
      </p>
    </section>
  );
}
