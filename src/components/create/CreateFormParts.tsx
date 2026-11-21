import { motion } from "framer-motion";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { MAX_GAME_PLAYERS, MIN_GAME_PLAYERS } from "@/lib/game-policy";
import { REPEAT_OPTIONS, type RepeatChoice } from "@/lib/game-series-api";

/** Building blocks of the "Host a game" form (src/routes/_tabs.create.tsx). */

/** A problem shown right under its field; the field points at it with aria-describedby. */
export function FieldError({
  id,
  message,
  srOnly,
}: {
  id: string;
  message: string;
  srOnly?: boolean;
}) {
  return (
    <p
      id={id}
      className={srOnly ? "sr-only" : "mt-1 px-1 text-[12px] font-semibold text-destructive"}
    >
      {message}
    </p>
  );
}

export function Section({
  title,
  icon,
  right,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 section-eyebrow text-muted-foreground">
        {icon}
        {title}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function Toggle({
  icon,
  label,
  value,
  onChange,
  right,
}: {
  icon: React.ReactNode;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  right?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 text-sm"
    >
      <span className="flex items-center gap-2.5">
        <span className={value ? "text-lime" : "text-muted-foreground"}>{icon}</span>
        <span className="font-medium">{label}</span>
      </span>
      <span className="flex items-center gap-2">
        {right && <span className="text-xs text-muted-foreground">{right}</span>}
        <span
          className={`relative h-6 w-10 rounded-full transition-colors ${value ? "bg-lime" : "bg-secondary"}`}
        >
          <motion.span
            layout
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="absolute top-0.5 h-5 w-5 rounded-full bg-background shadow"
            style={{ left: value ? "calc(100% - 1.375rem)" : "0.125rem" }}
          />
        </span>
      </span>
    </button>
  );
}

/** The quick form's "Spots" (the game's player limit), typed or stepped, kept between the limits. */
export function SpotsStepper({
  id,
  text,
  value,
  onTextChange,
  error,
}: {
  id: string;
  text: string;
  /** The current valid number, for the buttons. */
  value: number;
  onTextChange: (text: string) => void;
  error?: string;
}) {
  const clamp = (n: number) => Math.min(MAX_GAME_PLAYERS, Math.max(MIN_GAME_PLAYERS, n));
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <>
      <div
        className={`flex items-center gap-3 rounded-2xl border bg-surface px-3 py-2 ${
          error ? "border-destructive" : "border-border"
        }`}
      >
        <button
          type="button"
          aria-label="Fewer spots"
          onClick={() => onTextChange(String(clamp(value - 1)))}
          disabled={value <= MIN_GAME_PLAYERS}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-background disabled:opacity-40"
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          aria-label="Spots"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onBlur={() => {
            // Round and clamp a typed number; a blank box is left for the inline error.
            const n = Number(text);
            if (text.trim() && Number.isFinite(n)) onTextChange(String(clamp(Math.round(n))));
          }}
          className="h-11 min-w-0 flex-1 rounded-xl bg-transparent text-center text-lg font-bold outline-none"
        />
        <button
          type="button"
          aria-label="More spots"
          onClick={() => onTextChange(String(clamp(value + 1)))}
          disabled={value >= MAX_GAME_PLAYERS}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-background disabled:opacity-40"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {error && <FieldError id={errorId} message={error} />}
      <p id={hintId} className="px-1 text-[11px] text-muted-foreground">
        How many players can join ({MIN_GAME_PLAYERS}–{MAX_GAME_PLAYERS}).
      </p>
    </>
  );
}

/** Repeat for a one-day game (WP 3.1): the server creates the next dates. */
export function RepeatField({
  untilId,
  value,
  onChange,
  firstDate,
  untilError,
}: {
  untilId: string;
  value: RepeatChoice;
  onChange: (update: (prev: RepeatChoice) => RepeatChoice) => void;
  firstDate: string;
  untilError?: string;
}) {
  const hintId = `${untilId}-hint`;
  const errorId = `${untilId}-error`;
  return (
    <div className="space-y-2">
      <div className="px-1 text-[12px] font-semibold text-muted-foreground">Repeat</div>
      <div
        role="radiogroup"
        aria-label="Repeat"
        className="flex flex-wrap gap-2"
        data-testid="repeat-choice"
      >
        {REPEAT_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value.freq === o.value}
            onClick={() =>
              onChange((r) => ({ freq: o.value, until: o.value === "none" ? null : r.until }))
            }
            className={`min-h-11 rounded-full border px-3 py-2 text-[13px] font-semibold ${
              value.freq === o.value
                ? "border-lime bg-lime/10 text-lime"
                : "border-border bg-surface text-muted-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {value.freq !== "none" && (
        <div className="space-y-1">
          <label
            htmlFor={untilId}
            className="block px-1 text-[12px] font-semibold text-muted-foreground"
          >
            Last date (optional)
          </label>
          <input
            id={untilId}
            type="date"
            min={firstDate}
            value={value.until ?? ""}
            aria-invalid={untilError ? true : undefined}
            aria-describedby={untilError ? `${hintId} ${errorId}` : hintId}
            onChange={(e) => onChange((r) => ({ ...r, until: e.target.value || null }))}
            className={`w-full rounded-xl border bg-background px-3 py-2 text-sm ${
              untilError ? "border-destructive" : "border-border"
            }`}
          />
          {untilError && <FieldError id={errorId} message={untilError} />}
          <p id={hintId} className="px-1 text-[11px] text-muted-foreground">
            Dates are added up to 4 weeks ahead. Each new date copies the latest one, so edits to it
            carry forward.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The "More options" disclosure button. While closed it lists the settings that
 * decide who can join and what it costs, so nothing hidden there is a surprise.
 */
export function MoreOptionsToggle({
  open,
  onToggle,
  controls,
  summary,
  hasProblem,
}: {
  open: boolean;
  onToggle: () => void;
  controls: string;
  summary: string[];
  hasProblem: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="block text-sm font-semibold">More options</span>
          <span className="block text-[11px] text-muted-foreground">
            Title, photo, skill, positions, fee, privacy, approval, ages, cancellation and rules
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {!open && (
        <p
          data-testid="more-options-summary"
          className="border-t border-border px-4 py-2 text-[12px] text-muted-foreground"
        >
          {summary.join(" · ")}
        </p>
      )}
      {!open && hasProblem && (
        <p className="px-4 pb-2 text-[12px] font-semibold text-destructive">
          Something under More options needs fixing.
        </p>
      )}
    </div>
  );
}
