import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { suggestGameDetails, type GameDraft } from "@/lib/game-assist.functions";
import { AI_RESULTS_CAVEAT } from "@/lib/ai-video-privacy";
import type { Sport } from "@/lib/sample-data";

/**
 * Drafting help for the host-a-game form.
 *
 * Deliberately small. It fills the title and description — the parts that
 * actually take a host time to write — and shows the rest (player count, kit,
 * a pre-game checklist) as advice next to the form rather than writing it
 * anywhere. Equipment and the checklist have no field on this form, and a
 * suggested player count is a judgement the host should make by hand.
 *
 * Nothing here creates a game. The host still fills in the rest and presses the
 * same submit button as always.
 */
export function GameDraftAssist({
  sport,
  skill,
  onApply,
}: {
  sport: Sport;
  skill: string;
  /** Fills the form fields the host can then edit. */
  onApply: (draft: Pick<GameDraft, "title" | "description">) => void;
}) {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GameDraft | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const out = (await suggestGameDetails({
        data: { sport, skill, intent: intent.trim() || undefined },
      })) as GameDraft;
      setDraft(out);
      onApply({ title: out.title, description: out.description });
    } catch (e) {
      // The gate throws already-user-safe text (AI_ERROR_MESSAGES), so consent,
      // guardian-approval and quota denials each read correctly without a
      // mapping here. Anything else arrives as a plain message.
      setError(e instanceof Error ? e.message : "Couldn't draft that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-lime hover:text-foreground"
      >
        <Sparkles className="h-3.5 w-3.5 text-lime" aria-hidden />
        Help me write this
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface p-3">
      <label className="block text-xs font-semibold text-muted-foreground" htmlFor="game-intent">
        What kind of game is it?
      </label>
      <input
        id="game-intent"
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        maxLength={500}
        placeholder="Casual 5v5 after work, all welcome"
        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-lime px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          )}
          {busy ? "Drafting…" : draft ? "Try again" : "Draft it"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      {error ? <p className="text-xs font-semibold text-coral">{error}</p> : null}

      {draft ? (
        <div className="space-y-2 border-t border-border pt-2">
          <p className="text-[11px] text-muted-foreground">
            Title and description filled in above — edit them freely.
          </p>

          {draft.skillNote ? (
            <p className="text-xs text-muted-foreground">{draft.skillNote}</p>
          ) : null}

          <dl className="space-y-1.5 text-xs">
            <div className="flex gap-2">
              <dt className="shrink-0 font-semibold text-muted-foreground">Suggested size</dt>
              <dd>{draft.maxPlayers} players</dd>
            </div>
            {draft.equipment.length > 0 ? (
              <div className="flex gap-2">
                <dt className="shrink-0 font-semibold text-muted-foreground">Bring</dt>
                <dd>{draft.equipment.join(", ")}</dd>
              </div>
            ) : null}
          </dl>

          {draft.checklist.length > 0 ? (
            <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
              {draft.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}

          <p className="text-[11px] text-muted-foreground">{AI_RESULTS_CAVEAT}</p>
        </div>
      ) : null}
    </div>
  );
}
