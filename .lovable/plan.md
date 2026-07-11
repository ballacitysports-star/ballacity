## Goal

Make avatars appear consistently everywhere a person is shown in the app — uploaded photo when available, initials on a brand-tinted circle as fallback, and a neutral placeholder while a profile is still loading. Right now most surfaces render text-only initials in a colored circle and never look at `avatar_url`, so anyone with an uploaded photo appears as bare letters.

## What changes

**1. One canonical `<UserAvatar>` component**

Rewrite `src/components/UserAvatar.tsx` to be generic (usable for any user, not just "me"):

```tsx
<UserAvatar
  avatarUrl={...}
  initials={...}
  name={...}
  size="sm" | "md" | "lg"
  active?={boolean}   // lime ring for the bottom-nav "My Card" state
  className?={string}
/>
```

Plus a small `<MyAvatar />` wrapper that reads `useMyProfile()` and forwards to `<UserAvatar>` — used by the bottom nav and top headers.

Behaviour:
- If `avatarUrl` present → `<img>` (Radix Avatar handles error fallback).
- Else → initials on `bg-lime/20` circle.
- Loading (no profile yet) → same circle with a neutral placeholder, no "?".

**2. Persistent top-header avatar**

Every tab currently renders `<Logo />` on the left and `Messages + Bell` on the right (feed, players, teams, discover, reels, notifications). Add a `<MyAvatar>` link → `/profile` as the right-most element in that group on all six tab headers.

**3. Swap initials-only circles for `<UserAvatar>`**

Replace hand-rolled initials circles across these surfaces so uploaded photos actually show:

- `src/components/GameCard.tsx` — host chip (two spots: lines ~161 and ~165).
- `src/routes/games.$gameId.tsx` — host header (line ~756), roster grid (already partially handles `avatarUrl` at lines ~881 and ~1120 — normalise through `<UserAvatar>` so the fallback matches everywhere).
- `src/routes/messages.$conversationId.tsx` — thread header (lines ~190 and ~194); extend the `MessagesList` fetcher already selecting `display_name, avatar_initials` to also select `avatar_url`.
- `src/routes/messages.index.tsx` — conversation list rows (extend `messages.ts` `ConversationListItem` with `other_avatar_url` from the profiles fetch already at `src/lib/messages.ts:99`).
- `src/routes/_tabs.players.tsx` — player cards.
- `src/routes/_tabs.notifications.tsx` — actor avatars where present.
- `src/components/ReviewsSection.tsx` — reviewer avatar.
- `src/routes/available-players.tsx` — availability cards.

**4. Data — surface `avatar_url` where it's missing**

Some fetchers project `display_name, avatar_initials` but not `avatar_url`, so no image can ever render:

- `src/lib/messages.ts` — add `avatar_url` to the `profiles` select and the `ConversationListItem` type; map it into `other_avatar_url`.
- `src/routes/games.$gameId.tsx` — the three profile selects at lines ~1645/1815/1928 currently ignore `avatar_url`; add it and pass through.
- `src/lib/game-roster.ts` and `src/lib/availability.ts` — verify `avatar_url` is on the select and typed on the returned row; add if missing.

No new tables, no policy changes — `profiles.avatar_url` already exists and the current SELECT policies on `profiles` already return it.

## Out of scope

- No changes to how avatars are uploaded (that flow already writes `profiles.avatar_url` from `profile.edit.tsx`).
- No new "avatar menu" — tapping the header avatar just navigates to `/profile`, matching the bottom nav behaviour.
- No design-token or theme changes.

## Technical notes

- Radix `AvatarImage` fires `onLoadingStatusChange`; `AvatarFallback` renders automatically when the image errors or is absent, so no manual `onError` wiring is needed.
- `useMyProfile()` returns `null` during hydration — `<MyAvatar>` will render the neutral placeholder in that window instead of "?" to avoid the flash of a broken glyph.
- All new `<img>` usages get `alt={name}` (or `alt=""` when purely decorative next to a visible name) to keep the a11y contract already established by `<SpotsPill>`.
- No changes to `src/integrations/supabase/*` (auto-generated).