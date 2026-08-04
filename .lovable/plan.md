# Make the availability card's hero open the player profile

Right now on Available Players only the avatar, the name in the header, and the name in the caption link to a player's profile. The big square hero (the sport emoji block you selected) is not clickable, so tapping the largest part of the card does nothing.

## What changes

- The hero square becomes a link to that player's public profile (`/players/{userId}`), same destination as the avatar and name.
- Add clear affordances so it reads as clickable:
  - subtle press/hover feedback on the hero
  - a small "View profile" chip in the hero corner
  - accessible label so screen readers announce it as "View {name}'s profile"
- The sport chips overlaid at the bottom of the hero stay purely visual (no nested links), and the action row (like, message, save, edit, remove) keeps working exactly as it does now — those buttons stay outside the link area.

## Technical notes

- File: `src/routes/available-players.tsx`, availability card component (hero block around lines 863-889).
- Wrap the hero `div` in a TanStack `Link to="/players/$userId" params={{ userId: a.user_id }}`, keeping `relative aspect-square` layout classes on the link so the absolute-positioned emoji, gradient, and chips are unchanged.
- Add `group` + `active:opacity-90 transition` for touch feedback and `aria-label` for the accessible name.
- No data, query, or backend changes.
