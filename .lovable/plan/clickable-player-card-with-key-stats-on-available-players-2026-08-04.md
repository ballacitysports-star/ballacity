# Clickable player card with key stats on Available Players

Right now the big sport square is decorative and the only way to reach a player's profile is the small avatar or name. This makes the card itself the entry point and surfaces the key stats up front.

## What changes

- The hero square (the sport emoji block) becomes a link to that player's public profile, the same destination as the avatar and name. It gets a subtle press/hover response and a small "View profile" chip in the corner so it reads as tappable.
- A compact stats strip is added under the hero, above the action row:
  - skill level for the primary sport (already resolved profile-first, e.g. "Minor AAA")
  - number of sports they play
  - home city
  - travel radius in the viewer's distance unit
  - next availability window when the post has one
- A full-width "View full profile" button ends the card, so there is an unmissable path to the profile on mobile.
- The sport chips over the hero stay decorative (no nested links) and the existing action row (like, message, contact, save, edit, remove) keeps working unchanged — those buttons stay outside the link area.

## Technical notes

- All changes are in the availability card component in `src/routes/available-players.tsx` (hero block ~lines 863-889, action row, caption).
- Wrap the hero in a TanStack `Link to="/players/$userId" params={{ userId: a.user_id }}`, moving `relative aspect-square w-full overflow-hidden` onto the link so the absolute emoji, gradient, and chips render identically. Add `group`, `active:opacity-90 transition`, and an `aria-label` of "View {name}'s profile".
- Stats strip reuses existing helpers: `resolvePlayerLevel` + `formatSportLevel` for the tier, `<Distance km={a.travel_radius_km} />` for radius, and the already-computed `when` string for the window. Rendered as small label/value cells with border separators, no new data fetching.
- "View full profile" is a `Link` styled with the existing button/pill classes.
- No query, schema, or backend changes.
