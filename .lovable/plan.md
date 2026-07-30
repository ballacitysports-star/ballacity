## Goal

Rebuild the feed preference sheet so it reads clearly, saves to your account, and supports saved presets you can tap to apply.

## What's wrong today

The sheet (`FeedFilterBody` in `src/routes/_tabs.feed.tsx`) has four flat blocks: Sort by, Sport, Distance, and a "Sections" list of six identical switches. The problem is that "Sections" quietly mixes two different kinds of setting:

- **Display toggles** — "Needs players now", "For you list" — these turn feed sections on and off.
- **Hard filters** — "Games I host", "Games I joined", "Free games", "Paid games" — these remove games from results.

Because they look identical, turning on "Paid games" feels like showing a section but actually hides most of the feed. There are also silent mutual-exclusion rules (paid clears free, hosted clears joined) that the user never sees explained. Preferences live only in `localStorage`, so they don't follow you between devices.

## New structure

Three clearly separated groups, in this order:

```text
┌─ Feed filters ─────────────────────────┐
│  MY VIEWS                              │
│  [ All games ] [ Weeknights ] [ + ]    │  ← saved presets, tap to apply
│                                        │
│  1. NARROW RESULTS                     │
│     Sport         chips (multi)        │
│     Distance      Any 5 10 25 · unit   │
│     Show me       All / Free / Paid    │  ← segmented, exclusivity obvious
│     My games      All / Hosting / Joined│  ← segmented, exclusivity obvious
│                                        │
│  2. ORDER                              │
│     Sort          Nearest / Soonest    │
│                                        │
│  3. FEED LAYOUT                        │
│     ▸ Needs players now      [toggle]  │
│     ▸ For you                [toggle]  │
│                                        │
│  [ Reset ]                [ Show 24 ]  │  ← live count in the footer
└────────────────────────────────────────┘
```

Key changes:

- The four filter switches become two **segmented pickers** ("Show me": All / Free only / Paid only; "My games": All / Hosting / Joined). Exclusivity becomes visually obvious instead of a hidden rule, and the underlying booleans no longer need cross-clearing hacks.
- Only the two genuine display toggles stay as switches, under a "Feed layout" heading.
- A live result count on the apply button so you can see the effect of a filter before closing the sheet.
- Each group shows a small count badge of how many filters are active within it, and "Reset" only clears filters (not your layout toggles).

## Saved presets

A "My views" row at the top of the sheet. Each preset stores a full snapshot of sport, distance, unit, sort, and the two exclusivity pickers.

- Tap a preset chip to apply it; the active one is highlighted.
- "Save current as view" prompts for a name (with a suggested name derived from the active filters, e.g. "Basketball · 10 mi · Soonest").
- Long-press / overflow on a chip to rename or delete.
- "All games" is a built-in, non-deletable preset equal to the defaults.
- Editing any filter while a preset is active marks it "Edited" with an inline "Update view" action, so you never silently overwrite a saved view.

Presets also render as a compact row directly above the feed's sport chips, so common views are one tap away without opening the sheet.

## Account sync

Preferences and presets move to a `feed_preferences` table keyed to your user, with the existing `localStorage` store kept as an offline cache and as the storage for signed-out visitors.

- Signed in: read from your account on load, write with a short debounce (the same pattern as the existing real-time profile save), so switching devices carries your setup over.
- Signed out: behaves exactly as today, on-device only.
- First sign-in after this change adopts whatever is currently on the device rather than wiping it.
- Shared links keep winning over saved preferences, as they do today, so a shared feed URL always shows the sender's view.

## Technical notes

- New `src/components/feed/FeedPreferencesSheet.tsx` plus small pieces (`SegmentedFilter`, `PresetRow`) so `_tabs.feed.tsx` stops holding this UI inline; the route keeps ownership of filtering, URL sync, and result counts.
- `FeedPrefs` in `src/lib/user-prefs-store.ts` gains `moneyFilter: "all" | "free" | "paid"` and `mineFilter: "all" | "hosting" | "joined"`, replacing the four booleans in `sections`; `sections` narrows to the two display toggles. A migration in the store's loader maps existing localStorage values forward so nobody loses their current setup.
- New `savedViews: FeedView[]` on the prefs shape (`id`, `name`, `filters` snapshot, `createdAt`).
- Database migration: `feed_preferences` (`user_id` primary key, `prefs` jsonb, `saved_views` jsonb, timestamps) with grants and owner-only access rules, plus an updated-at trigger. Reads and writes go through a new `src/lib/feed-prefs.functions.ts` using the authenticated server-function path.
- Filtering in the route switches from the six booleans to the two new enum fields; URL params keep short names, with the old `free`/`paid`/`hosted`/`joined` params still accepted on read so existing shared links keep working.
- Preset apply/save/delete are pure prefs writes, so no change to feed query logic is needed.

## Out of scope

No new filter dimensions (time of day, skill level, indoor/outdoor, spots left) in this pass — the rebuild is about structure, sync, and presets. Easy to add afterwards since "Narrow results" becomes the obvious home for them.
