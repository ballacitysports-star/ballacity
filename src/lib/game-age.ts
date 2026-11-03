/**
 * Optional per-game age requirement.
 *
 * Hosts can set a minimum age, a maximum age, or both. Players inside the
 * range follow the normal join flow. Players outside it — or who haven't
 * shared a birthday — cannot join or request a spot: a host cannot approve
 * someone past the range (the database refuses it as well).
 */

export type AgeRequirement = {
  minAge?: number | null;
  maxAge?: number | null;
};

// Youth games are supported, so the host-selectable floor goes below 13.
// Under-13 participation is separately gated by parental consent + controls.
export const AGE_MIN = 5;
export const AGE_MAX = 99;

export function hasAgeRequirement(req: AgeRequirement | null | undefined): boolean {
  if (!req) return false;
  return req.minAge != null || req.maxAge != null;
}

/** "18+", "13–17", "Up to 17", or null when no requirement is set. */
export function ageRequirementLabel(req: AgeRequirement | null | undefined): string | null {
  if (!req) return null;
  const min = req.minAge ?? null;
  const max = req.maxAge ?? null;
  if (min != null && max != null) return min === max ? `Age ${min}` : `${min}–${max}`;
  if (min != null) return `${min}+`;
  if (max != null) return `Up to ${max}`;
  return null;
}

export function isAgeEligible(
  age: number | null | undefined,
  req: AgeRequirement | null | undefined,
): boolean {
  if (!hasAgeRequirement(req)) return true;
  if (age == null || !Number.isFinite(age)) return false;
  if (req!.minAge != null && age < req!.minAge) return false;
  if (req!.maxAge != null && age > req!.maxAge) return false;
  return true;
}

export type AgeGateState = "none" | "eligible" | "ineligible" | "unknown_age";

export function ageGateState(input: {
  req: AgeRequirement | null | undefined;
  viewerAge: number | null | undefined;
}): AgeGateState {
  const { req, viewerAge } = input;
  if (!hasAgeRequirement(req)) return "none";
  if (viewerAge == null || !Number.isFinite(viewerAge)) return "unknown_age";
  return isAgeEligible(viewerAge, req) ? "eligible" : "ineligible";
}

/** Short player-facing explanation of why the viewer cannot join. */
export function ageGateMessage(
  state: AgeGateState,
  req: AgeRequirement | null | undefined,
): string | null {
  const label = ageRequirementLabel(req);
  if (!label) return null;
  if (state === "ineligible") {
    return `This game is ${label}. It isn't open to your age, and a host can't make an exception.`;
  }
  if (state === "unknown_age") {
    return `This game is ${label}. Add your birthday to your profile to see whether you can join.`;
  }
  return null;
}

/** Host-facing label for a requester, e.g. "Age 15 · outside 18+". */
export function requesterAgeLabel(
  age: number | null | undefined,
  req: AgeRequirement | null | undefined,
): string | null {
  if (!hasAgeRequirement(req)) return null;
  const label = ageRequirementLabel(req);
  if (age == null || !Number.isFinite(age)) return "Age not shared";
  return isAgeEligible(age, req) ? `Age ${age}` : `Age ${age} · outside ${label}`;
}

export function clampAge(value: number): number {
  return Math.min(AGE_MAX, Math.max(AGE_MIN, Math.round(value)));
}

/** One-tap host presets shown before the custom range editor. */
export const AGE_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  minAge: number | null;
  maxAge: number | null;
}> = [
  { id: "any", label: "Any age", minAge: null, maxAge: null },
  { id: "13", label: "13+", minAge: 13, maxAge: null },
  { id: "16", label: "16+", minAge: 16, maxAge: null },
  { id: "18", label: "18+", minAge: 18, maxAge: null },
  { id: "21", label: "21+", minAge: 21, maxAge: null },
];

/** Which preset (if any) matches the current values; "custom" otherwise. */
export function matchAgePreset(req: AgeRequirement | null | undefined): string {
  const min = req?.minAge ?? null;
  const max = req?.maxAge ?? null;
  const hit = AGE_PRESETS.find((p) => p.minAge === min && p.maxAge === max);
  return hit ? hit.id : "custom";
}
