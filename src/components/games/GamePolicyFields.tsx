import { Users, CalendarX, ListPlus, ScrollText, DollarSign } from "lucide-react";
import { RefundPolicyFields } from "@/components/RefundPolicyFields";
import {
  CANCELLATION_POLICIES,
  MAX_GAME_PLAYERS,
  MIN_GAME_PLAYERS,
  type GamePolicy,
} from "@/lib/game-policy";

/**
 * Host-facing game policy editor. Shared by the create flow and the edit sheet
 * so a game's policy reads identically wherever it's set.
 */
export function GamePolicyFields({
  value,
  onChange,
  idPrefix = "policy",
  showPayment = true,
}: {
  value: GamePolicy;
  onChange: (next: GamePolicy) => void;
  idPrefix?: string;
  showPayment?: boolean;
}) {
  const set = <K extends keyof GamePolicy>(key: K, v: GamePolicy[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="space-y-2">
      {/* Player counts */}
      <div className="rounded-2xl border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4 text-lime" aria-hidden /> Player count
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor={`${idPrefix}-min-players`}
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Minimum to play
            </label>
            <input
              id={`${idPrefix}-min-players`}
              type="number"
              inputMode="numeric"
              min={0}
              max={value.maxPlayers}
              value={value.minPlayers}
              onChange={(e) =>
                set("minPlayers", Math.max(0, Math.round(Number(e.target.value) || 0)))
              }
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
            />
          </div>
          <div>
            <label
              htmlFor={`${idPrefix}-max-players`}
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Player limit
            </label>
            <input
              id={`${idPrefix}-max-players`}
              type="number"
              inputMode="numeric"
              min={MIN_GAME_PLAYERS}
              max={MAX_GAME_PLAYERS}
              value={value.maxPlayers}
              onChange={(e) =>
                set(
                  "maxPlayers",
                  Math.min(
                    MAX_GAME_PLAYERS,
                    Math.max(
                      MIN_GAME_PLAYERS,
                      Math.round(Number(e.target.value) || MIN_GAME_PLAYERS),
                    ),
                  ),
                )
              }
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
            />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          0 minimum means the game runs no matter the turnout. Players see this before joining.
        </p>
        {value.minPlayers > value.maxPlayers && (
          <p className="mt-1 text-[11px] font-semibold text-destructive">
            Minimum can't be more than the limit.
          </p>
        )}
      </div>

      {/* Waitlist */}
      <button
        type="button"
        onClick={() => set("allowWaitlist", !value.allowWaitlist)}
        className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2.5">
          <ListPlus
            className={`h-4 w-4 ${value.allowWaitlist ? "text-lime" : "text-muted-foreground"}`}
            aria-hidden
          />
          <span>
            <span className="block text-sm font-medium">Waitlist when full</span>
            <span className="block text-[11px] text-muted-foreground">
              Players take an open spot automatically if someone drops.
            </span>
          </span>
        </span>
        <span
          role="switch"
          aria-checked={value.allowWaitlist}
          className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
            value.allowWaitlist ? "bg-lime" : "bg-secondary"
          }`}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all"
            style={{ left: value.allowWaitlist ? "calc(100% - 1.375rem)" : "0.125rem" }}
          />
        </span>
      </button>

      {/* Cancellation policy */}
      <div className="rounded-2xl border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <CalendarX className="h-4 w-4 text-lime" aria-hidden /> Cancellation policy
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {CANCELLATION_POLICIES.map((p) => {
            const active = value.cancellationPolicy === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => set("cancellationPolicy", p.id)}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  active
                    ? "border-lime bg-lime/10 text-lime"
                    : "border-border bg-background text-muted-foreground"
                }`}
              >
                <span className="block text-sm font-semibold">{p.label}</span>
                <span className="block text-[11px] opacity-80">{p.short}</span>
              </button>
            );
          })}
        </div>
        <textarea
          rows={2}
          value={value.cancellationNotes}
          onChange={(e) => set("cancellationNotes", e.target.value)}
          placeholder={
            value.cancellationPolicy === "custom"
              ? "Describe your cancellation terms (required)"
              : "Optional: anything players should know about dropping out"
          }
          className="mt-2 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
        />
      </div>

      {/* Payment requirement + refunds */}
      {showPayment && (
        <div className="rounded-2xl border border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <DollarSign className="h-4 w-4 text-lime" aria-hidden /> Payment requirement
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {value.entryFee > 0
              ? `Players owe $${value.entryFee} and pay you directly — BallaCity doesn't process payments or issue refunds.`
              : "This game is free. Set an entry fee in the fee field to require payment."}
          </p>
          {value.entryFee > 0 && (
            <>
              <RefundPolicyFields
                className="mt-3"
                idPrefix={`${idPrefix}-refund-rule`}
                value={{ rule: value.refundRule, latePct: value.lateRefundPct }}
                onChange={(r) => onChange({ ...value, refundRule: r.rule, lateRefundPct: r.latePct })}
                cutoffMin={value.cancelCutoffMin}
              />
              <label
                htmlFor={`${idPrefix}-refund`}
                className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Extra refund notes (optional)
              </label>
              <textarea
                id={`${idPrefix}-refund`}
                rows={2}
                value={value.refundPolicy}
                onChange={(e) => set("refundPolicy", e.target.value)}
                placeholder="e.g. Rain-outs are refunded in full."
                className="mt-1 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
              />
            </>
          )}
        </div>
      )}

      {/* Game rules */}
      <div className="rounded-2xl border border-border bg-surface px-4 py-3">
        <label
          htmlFor={`${idPrefix}-rules`}
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <ScrollText className="h-4 w-4 text-lime" aria-hidden /> Game rules
        </label>
        <textarea
          id={`${idPrefix}-rules`}
          rows={3}
          value={value.gameRules}
          onChange={(e) => set("gameRules", e.target.value)}
          placeholder="Format, scoring, calls, subs, gear, facility rules players must follow."
          className="mt-2 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
        />
      </div>
    </div>
  );
}
