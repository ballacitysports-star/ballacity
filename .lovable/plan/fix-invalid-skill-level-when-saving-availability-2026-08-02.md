# Fix "Invalid skill level" when saving availability

## What's happening

The database still enforces the old generic skill list. The validation trigger on `player_availabilities` only accepts:

`All Levels, Beginner, Intermediate, Advanced, Pro`

But the post form now saves real per-sport tiers (`Minor AAA`, `3.5`, `Flag Rec · 7v7 Elite`, `AAU / Travel`), so any save with a level picked is rejected with `Invalid skill_level: …`.

Two related mismatches live in the same trigger and will break saves right after the skill fix:

- Allowed sports are `['Basketball','Soccer','Pickleball','Volleyball','Tennis','Flag Football','Baseball','Softball','Running']` — the app's sport is `Football`, not `Flag Football`, so picking Football fails with `Unknown sport: Football`.
- `travel_radius_km` is capped at 500 km, while the app now allows up to 12,500 mi (~20,100 km), so large radius selections fail.

## The fix

Rewrite `validate_player_availability` so it validates shape instead of a frozen list of tiers:

- **Skill level**: accept `All Levels` or a non-empty string up to 120 chars, allowing the `·` multi-tier separator. Tier correctness is already enforced in the app by `sanitizeSkillForSport` / `parseSkillTiers`, which is the only place that knows each sport's scale.
- **Sports**: align the allowed list with the app's `SPORTS` (`Baseball, Basketball, Football, Pickleball, Running, Soccer, Softball, Tennis, Volleyball`), keeping `Flag Football` accepted so existing rows still validate on update.
- **Radius**: raise the ceiling to 20,200 km to match the 12,500 mi cap, keeping the lower bound at 1.

Everything else in the trigger (time slots, days, note/city lengths, date ordering, immutable `user_id`) stays exactly as it is.

## Verification

- Save an availability post with a Baseball tier (`Minor AAA`) and a multi-tier Football value (`Flag Rec · 7v7 Elite`).
- Save with sport `Football` selected, and with a max-radius selection.
- Confirm existing posts still edit and save cleanly.
