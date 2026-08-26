# Make the age requirement simple to use

## What's wrong today

In Create Game, the age requirement block has two number inputs ("Minimum age" / "Maximum age"). Every keystroke is immediately clamped into the 5–99 range, so typing `18` first turns `1` into `5`, then produces `58`. In practice you can't type the age you want — that's the unusable part. There's also nothing stopping a minimum above the maximum.

## The fix: presets first, custom only if needed

Replace the two raw number boxes with a single row of tap-to-pick options:

- Any age (default, no requirement)
- 13+
- 16+
- 18+
- 21+
- Custom

Tapping a preset sets the requirement instantly — one tap, done. "Custom" reveals the two age fields, which now:

- let you type freely (no clamping mid-typing); the value is only corrected to the 5–99 range when you leave the field
- allow leaving either side blank for open-ended ("18 and up", "up to 17")
- auto-correct an inverted range on blur (if max ends up below min, max is raised to min)

The summary line under the control keeps showing the plain-language result ("18+", "13–17", "Up to 17") plus the existing note that players outside the range must request the host's approval.

## Where it applies

Both places the control appears: Create Game and the host's game settings on the game detail page. No change to how the requirement is stored, enforced, or shown to players.

## Technical notes

- `src/components/games/AgeRequirementFields.tsx`: rewrite the body — preset chips derived from the current `minAge`/`maxAge`, local string state for the custom inputs, `clampAge` moved from `onChange` to `onBlur`, inverted-range normalization on blur. Same props/callback contract, so both call sites stay unchanged.
- `src/lib/game-age.ts`: add a small `AGE_PRESETS` list (label + min/max) used by the chips; existing helpers untouched.
