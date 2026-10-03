# Streamline the landing page and highlight player availability

Single file: `src/routes/index.tsx`. Presentation only — no data, auth, or route changes.

## Streamline (remove overlap)

Current sections: hero, sports grid, how-it-works, 4 feature cards, trending, FAQ, CTA, footer.

- **Cut the "Built for players, not paperwork" feature-card section entirely.** Its four cards (join in seconds, real community, highlight reels, map-first discovery) repeat what the hero, how-it-works, and the new availability section already say. The page loses a whole scroll-depth of repeated claims.
- **Hero paragraph**: trim to one sentence naming the sports plus "or host your own run" — no new claims.
- **FAQ**: add one question that highlights the new feature ("How do teams and coaches find me?" → post your availability on the Players tab; teams browse it and send invites). Keep the existing five questions.
- Everything else stays: sports grid (links to all sport guides), how-it-works 3 steps, trending (real games), CTA, footer links.

## New section: "Post your availability. Get found."

Replaces the cut features section (same slot, after how-it-works):

- H2: "List your availability — let teams find you."
- Short lead: post when you're free to play and teams and coaches can find you and invite you directly.
- Three compact steps (same card style as how-it-works):
  1. **Post your availability** — sport, skill level, and when you're free.
  2. **Teams and coaches find you** — they browse available players by sport, skill, and distance.
  3. **Invites come to you** — accept, and you're on the roster.
- One CTA button: "Post your availability" → `/players` (signed-out visitors see the browse view; posting requires sign-in, which the app already handles).
- Reuses existing tokens and card styles; icons from lucide (e.g. CalendarClock, Search, UserPlus).

## Untouched

- No changes to `/players`, teams, onboarding, or any other page.
- No new statistics or invented numbers.
- Footer links stay (SEO value).

## Technical notes

- Only `src/routes/index.tsx` edits; delete the features block and its now-unused lucide imports if any (Zap, Users, Video may free up — remove leftovers so the build stays clean).
- `/players` is noindexed, so the link is for users, not SEO — the availability FAQ in text is what search engines see.
- Verify: typecheck clean, no horizontal overflow at 320–1280 px, and the availability section renders above the fold on mobile without pushing trending out of view.
