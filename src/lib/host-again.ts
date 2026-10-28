import type { Game } from "@/lib/sample-data";
import type { CreateDraft } from "@/lib/create-draft";

/** What "Host this again" carries over from a finished game into the create form. */
export type HostAgainPrefill = CreateDraft & { maxPlayers?: number };

/**
 * Starting a weekly run again should not mean retyping it. Carries over what a
 * host sets once and rarely changes. The date and venue are left out on purpose
 * (a stale date or place must never be published by accident), and so are the
 * roster, payments received and any cover photo. Only the game's own host gets
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
    indoor: game.indoor,
    priv: game.isPrivate,
    minAge: game.minAge ?? null,
    maxAge: game.maxAge ?? null,
    signupCutoffMin: game.signupCutoffMin ?? 0,
    maxPlayers:
      Number.isFinite(game.maxPlayers) && game.maxPlayers > 0 ? game.maxPlayers : undefined,
  };
}
