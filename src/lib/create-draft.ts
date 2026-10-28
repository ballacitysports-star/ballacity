/**
 * A half-filled "Host a game" form, kept on this device so leaving the page (a
 * stray Back, a dropped tab) doesn't cost the host their typing. Only the
 * fields that are slow to retype are kept: the schedule and venue are left out
 * so a stale date or place is never published by accident.
 */
export type CreateDraft = {
  sport?: string;
  title?: string;
  description?: string;
  skill?: string;
  paid?: boolean;
  feeText?: string;
  indoor?: boolean;
  priv?: boolean;
  requiresApproval?: boolean;
  minAge?: number | null;
  maxAge?: number | null;
  signupCutoffMin?: number;
};

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const keyFor = (userId: string) => `ballacity.create_draft.v1:${userId}`;

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
const age = (v: unknown) =>
  v === null ? null : typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** Only a draft with something typed is worth keeping or offering back. */
export function isMeaningfulDraft(d: CreateDraft): boolean {
  return !!(d.title?.trim() || d.description?.trim());
}

export function saveCreateDraft(storage: DraftStorage, userId: string, draft: CreateDraft): void {
  try {
    if (!isMeaningfulDraft(draft)) {
      storage.removeItem(keyFor(userId));
      return;
    }
    storage.setItem(keyFor(userId), JSON.stringify({ savedAt: Date.now(), draft }));
  } catch {
    /* storage full or unavailable: the form still works, it just isn't kept */
  }
}

export function clearCreateDraft(storage: DraftStorage, userId: string): void {
  try {
    storage.removeItem(keyFor(userId));
  } catch {
    /* ignore */
  }
}

export function loadCreateDraft(
  storage: DraftStorage,
  userId: string,
  now: number = Date.now(),
): CreateDraft | null {
  try {
    const raw = storage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown; draft?: Record<string, unknown> };
    if (typeof parsed.savedAt !== "number" || now - parsed.savedAt > MAX_AGE_MS) {
      storage.removeItem(keyFor(userId));
      return null;
    }
    const d = parsed.draft ?? {};
    const out: CreateDraft = {
      sport: str(d.sport, 40),
      title: str(d.title, 200),
      description: str(d.description, 5000),
      skill: str(d.skill, 120),
      paid: bool(d.paid),
      feeText: str(d.feeText, 12),
      indoor: bool(d.indoor),
      priv: bool(d.priv),
      requiresApproval: bool(d.requiresApproval),
      minAge: age(d.minAge),
      maxAge: age(d.maxAge),
      signupCutoffMin:
        typeof d.signupCutoffMin === "number" && Number.isFinite(d.signupCutoffMin)
          ? d.signupCutoffMin
          : undefined,
    };
    return isMeaningfulDraft(out) ? out : null;
  } catch {
    return null;
  }
}
