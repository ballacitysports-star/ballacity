# Sports Guide

A public, search-friendly guide covering all nine sports on ballaCity: Baseball, Basketball, Football, Pickleball, Running, Soccer, Softball, Tennis, Volleyball.

## What the user gets

- **A guide overview page** at `/guide` — short intro plus a card for every sport (emoji, name, typical group size, one-line "good to know"), linking to that sport's page.
- **A page per sport** at `/guide/basketball`, `/guide/soccer`, etc., each with:
  - How a pickup game usually works (players per side, how long a session runs, how to keep it fair)
  - What to bring (gear, footwear, ball, water)
  - Common positions/roles, taken from the positions already used in the app so nothing drifts
  - Etiquette and skill-level notes so newcomers know what to expect
  - How to get started on ballaCity: find a game near you, join, chat with the host, host your own — each as a real button to the existing screens
  - Links to the Safety Center and community guidelines
- Cross-links: the sport pages link back to the guide index and to browsing games for that sport.

Content will be written as accurate, general sports guidance (no invented venues, prices, or contact details). Editable in one place afterwards.

## Technical notes

- Content lives in one new module, `src/lib/sports-guide.ts`, keyed by the existing `Sport` type and reusing `SPORTS`, `POSITIONS_BY_SPORT`, and `imageFor` from `src/lib/sample-data.ts`, so every sport is covered by construction and a missing entry is a type error.
- Routes: `src/routes/guide.index.tsx` and `src/routes/guide.$sport.tsx`, following the existing static-page pattern (`BackHeader`, `page-shell-prose`, `pageHead` from `@/lib/seo`). Slug ↔ sport mapping helper in the content module; unknown slug renders `notFound()`.
- SEO: unique title/description per sport page via `pageHead`, single `h1`, semantic sections, JSON-LD `Article`; `/guide` and each `/guide/<sport>` added to `ENTRIES` in `src/routes/sitemap[.]xml.ts`.
- A small vitest covers: every `Sport` has guide content, every slug round-trips, and each sport's positions match `POSITIONS_BY_SPORT`.
- Entry point: a "Sports guide" link added alongside the existing Safety Center / guidelines links in the footer-style `PolicyLinks` area, plus a link from the discover screen header.
- No database, auth, or schema changes.
