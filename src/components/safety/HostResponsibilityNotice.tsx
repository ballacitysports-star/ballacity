import { Link } from "@tanstack/react-router";
import { Check, ShieldAlert } from "lucide-react";
import {
  HOST_ACK_CHECKBOX_LABEL,
  HOST_ACK_DISCLAIMER,
  HOST_ACK_ITEMS,
  LEGAL_REVIEW_LABEL,
} from "@/lib/game-policy";
import { ADDRESS_PRIVACY_NOTE } from "@/lib/safety";

/**
 * Host responsibility acknowledgments shown in the game creation flow.
 * Concise: one line per item, one checkbox for the set, never pre-checked.
 *
 * All copy here is configurable and pending legal review — see
 * `src/lib/game-policy.ts`.
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
          What you're taking on as host
        </div>
        <ul className="mt-2 space-y-2">
          {HOST_ACK_ITEMS.map((item) => (
            <li key={item.id} className="text-[12px] leading-relaxed">
              <span className="font-semibold">{item.label}</span>{" "}
              <span className="text-muted-foreground">— {item.text}</span>
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
          {HOST_ACK_CHECKBOX_LABEL}
        </label>
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        <span className="mr-1 rounded bg-secondary px-1.5 py-0.5 micro-label">
          {LEGAL_REVIEW_LABEL}
        </span>
        {HOST_ACK_DISCLAIMER} See the{" "}
        <Link to="/safety" target="_blank" rel="noreferrer" className="text-lime underline">
          Safety Center
        </Link>
        .
      </p>
    </div>
  );
}
