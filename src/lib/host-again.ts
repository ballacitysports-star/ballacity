import type { Game } from "@/lib/sample-data";
import { isMeaningfulDraft, type CreateDraft } from "@/lib/create-draft";

/** What "Host this again" carries over from a finished game into the create form. */
export type HostAgainPrefill = CreateDraft & { maxPlayers?: number };

/**
 * Starting a weekly run again should not mean retyping it. Carries over what a
 * host sets once and rarely changes. The date and venue are left out on purpose
 * (a stale date or place must never be published by accident), and so are the
 * roster, payments received and any cover photo. Approval to join is always
 * set back to required (the safe default) rather than copied, so a relaxed
 * setting on one game is never inherited silently by the next. Only the game's own host gets
 * a copy, so someone else's listing is never cloned from a link.
 */
export function hostAgainPrefill(
  game: Game,
  meId: string | null | undefined,
): HostAgainPrefill | null {
  if (!meId || !game.hostUserId || game.hostUserId !== meId) return null;
  const price = Number.isFinite(game.price) ? Math.max(0, game.price) : 0;
  return {
    sport: game.sport,
    title: game.title,
    description: game.description ?? "",
    skill: game.skill,
    paid: price > 0,
    ...(price > 0 ? { feeText: String(price) } : {}),
    requiresApproval: true,
    indoor: game.indoor,
    priv: game.isPrivate,
    minAge: game.minAge ?? null,
    maxAge: game.maxAge ?? null,
    signupCutoffMin: game.signupCutoffMin ?? 0,
    maxPlayers:
      Number.isFinite(game.maxPlayers) && game.maxPlayers > 0 ? game.maxPlayers : undefined,
  };
}

/**
 * A copy never replaces unfinished work on its own: with a title or description
 * already in the form, the host is asked first. The form autosaves, so a silent
 * replace would also overwrite the saved draft within half a second.
 */
export function planHostAgain(
  form: Pick<CreateDraft, "title" | "description">,
): "apply" | "confirm" {
  return isMeaningfulDraft(form) ? "confirm" : "apply";
}
