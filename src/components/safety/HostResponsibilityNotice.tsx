import { Link } from "@tanstack/react-router";
import { Check, ClipboardCheck, ShieldAlert } from "lucide-react";
import {
  ADDRESS_PRIVACY_NOTE,
  GAME_INFO_TIPS,
  HOST_RESPONSIBILITY,
  LEGAL_REVIEW_LABEL,
} from "@/lib/safety";

/**
 * Host responsibility acknowledgment + "good game info" checklist shown in the
 * game creation flow. The checkbox is never pre-checked.
 */
export function HostResponsibilityNotice({
  accepted,
  onChange,
  disabled,
}: {
  accepted: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ShieldAlert className="h-4 w-4 text-lime" aria-hidden />
          {HOST_RESPONSIBILITY.title}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {HOST_RESPONSIBILITY.text}
        </p>
        <ul className="mt-2 space-y-1.5">
          {HOST_RESPONSIBILITY.points.map((p) => (
            <li key={p} className="flex gap-2 text-[12px] leading-relaxed text-muted-foreground">
              <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
              {p}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardCheck className="h-4 w-4 text-lime" aria-hidden />
          Include this so players show up prepared
        </div>
        <ul className="mt-2 space-y-1.5">
          {GAME_INFO_TIPS.map((t) => (
            <li key={t.id} className="text-[12px] leading-relaxed">
              <span className="font-semibold">{t.label}</span>{" "}
              <span className="text-muted-foreground">— {t.hint}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {ADDRESS_PRIVACY_NOTE}
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface px-3 py-3">
        <button
          type="button"
          id="host-responsibility-ack"
          role="checkbox"
          aria-checked={accepted}
          disabled={disabled}
          onClick={() => onChange(!accepted)}
          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border transition disabled:opacity-50 ${
            accepted ? "border-lime bg-lime text-primary-foreground" : "border-border bg-background"
          }`}
        >
          {accepted ? <Check className="h-4 w-4" aria-hidden /> : null}
        </button>
        <label htmlFor="host-responsibility-ack" className="flex-1 text-xs leading-relaxed">
          {HOST_RESPONSIBILITY.checkboxLabel}
        </label>
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        <span className="mr-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
          {LEGAL_REVIEW_LABEL}
        </span>
        {HOST_RESPONSIBILITY.disclaimer} See the{" "}
        <Link to="/safety" target="_blank" rel="noreferrer" className="text-lime underline">
          Safety Center
        </Link>
        .
      </p>
    </div>
  );
}
