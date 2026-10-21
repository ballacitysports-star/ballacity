import {
  PARTIAL_REFUND_OPTIONS,
  REFUND_RULE_OPTIONS,
  refundPolicySummary,
  type RefundPolicy,
  type RefundRule,
} from "@/lib/refund-policy";

/**
 * Host-facing refund settings: the rule plus what late cancels / no-shows get
 * back, with a preview of exactly what players will be shown. The time frame
 * is the event's cancellation cutoff, passed in for the preview.
 */
export function RefundPolicyFields({
  value,
  onChange,
  cutoffMin,
  idPrefix = "refund",
  className = "",
}: {
  value: RefundPolicy;
  onChange: (next: RefundPolicy) => void;
  cutoffMin: number | null | undefined;
  idPrefix?: string;
  className?: string;
}) {
  const selectCls =
    "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground";
  return (
    <div className={`space-y-2 ${className}`}>
      <label
        htmlFor={`${idPrefix}-rule`}
        className="block text-xs font-semibold text-muted-foreground"
      >
        Refund policy
        <select
          id={`${idPrefix}-rule`}
          value={value.rule}
          onChange={(e) => onChange({ ...value, rule: e.target.value as RefundRule })}
          className={selectCls}
        >
          {REFUND_RULE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {value.rule !== "none" && (
        <label
          htmlFor={`${idPrefix}-late`}
          className="block text-xs font-semibold text-muted-foreground"
        >
          {value.rule === "before_start" ? "No-shows" : "Late cancellations and no-shows"}
          <select
            id={`${idPrefix}-late`}
            value={value.latePct}
            onChange={(e) => onChange({ ...value, latePct: Number(e.target.value) || 0 })}
            className={selectCls}
          >
            {PARTIAL_REFUND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="rounded-xl border border-border bg-surface/60 p-2.5 text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">Players will see: </span>
        {refundPolicySummary(value, cutoffMin)}
      </p>
    </div>
  );
}
