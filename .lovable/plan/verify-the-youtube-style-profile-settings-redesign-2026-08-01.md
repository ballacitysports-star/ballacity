# Verify the YouTube-style profile & settings redesign

The redesign compiles and lints cleanly, but nothing has been checked visually: the preview session is signed out, and `/profile`, `/settings`, and `/players/$userId` all redirect to `/auth`, so the last screenshot attempt only captured the sign-in page.

## What "verified" means here

Confirm on real rendered screens that:

- Banner renders at the wide 6:1 ratio, corners rounded, no stretching, overlay control (settings gear / back arrow) sits top-right and is tappable.
- Avatar is the large circle overlapping nothing, initials fallback works when there is no photo.
- One muted meta line reads `@handle · age · city · N followers · N following · N games`, truncates instead of wrapping into a block, and followers/following open the follow list.
- Bio shows on a single clamped line with `...more`, and tapping it opens the About sheet with Bio / Details / Stats / Links / Reputation blocks.
- Action pills scroll horizontally without clipping: Edit profile, Reviews, About, Settings (my profile) and Follow/Following, Message, Reviews, About, safety menu (public profile).
- Underlined text tabs (Games, Hosting, Requests with count, Reviews) switch panels, and panel bodies read as flat lists with no leftover card chrome.
- Settings renders as full-width rows with icon, label, description and hairline dividers, with the identity row on top and Delete account as a destructive row.
- No console errors on any of the three screens; mobile width (~420px) and desktop width both hold up.

## How to get an authenticated view

Two options:

1. Sign in through the Lovable preview once. The session then injects into the sandbox on the next turn and the screens can be captured directly as the real account.
2. Drive the sign-in form with the repo's existing E2E fixture account (`e2e-player@lovable.test`, credentials documented in `docs/e2e-test-accounts.md`) and capture from that session. This does not require the preview session and also exercises a profile with sparse data — good for checking the empty bio / no-banner fallbacks.

Option 2 needs no action from you, so the check runs with the fixture account unless you'd rather see your own profile.

## Steps

1. Sign in with the fixture account, then capture `/profile`, `/settings`, and a public `/players/$userId` at 420px wide and again at 1280px.
2. Capture element-level shots of the banner + avatar block, the meta line, the pill row, and the tab bar to inspect spacing and truncation closely.
3. Open the About sheet and each of the four tabs, capturing one shot per state.
4. Collect console errors and any failed requests for each screen.
5. Report findings with the screenshots, and fix anything that is off (spacing, truncation, leftover card chrome, missing tab counts) in the same pass.

## Technical notes

Verification is Playwright-driven against the local dev server at `http://localhost:8080`, screenshots written under `/tmp/browser/`. No project files change during verification itself; only follow-up fixes would touch `src/components/profile/*`, `src/components/settings/SettingsRow.tsx`, `src/routes/_tabs.profile.tsx`, `src/routes/players.$userId.tsx`, and `src/routes/settings.tsx`.
