# Complete per-page SEO metadata across every page

Today only a handful of pages have full metadata. Most have a bare title (or none), almost no page has `og:url` or a canonical link, and there is no sitemap or robots file. This brings every page up to the same standard and sets the convention for pages added later.

## What will change

- **Every page gets its own metadata**: a unique title, a description written for that page, matching `og:title` / `og:description`, `og:url`, `twitter:card`, and a self-referencing canonical link.
- **Public, shareable pages** (home, game detail, player profile, team, trainer, gym, gyms list, pickup, plans, shop, reviews) get richer descriptions built from real page data where available (game title, team name, city), plus `og:type` and structured data so search engines and link previews show the right thing.
- **Private pages** (feed, discover, players, teams, trainers, reels, create, notifications, profile, settings, account, messages, payments, checkout, onboarding, auth, reset password, admin, dev, edit screens, org/team/trainer create) get proper titles and descriptions but are marked "do not index", since they require sign-in and shouldn't appear in search results.
- **Missing pages get metadata for the first time**: Discover, Notifications, Reels, Account notifications, Checkout return, Pickup, and the OAuth consent screen.
- **Site-wide files added**: `robots.txt` (allowing crawlers, pointing at the sitemap) and `sitemap.xml` listing the public routes.
- **Convention documented** so new pages follow the same pattern automatically.

Social previews cached by Facebook, X, iMessage, etc. won't refresh instantly — those platforms re-scrape on their own schedule, though their link-preview debuggers can force it.

## Technical section

- Domain for canonical/`og:url`: `https://open-run-connect.lovable.app`.
- Per route, use the existing `head()` option in `createFileRoute`; `title` stays as a `meta` entry. Canonical goes in `links` on leaf routes only — never on `__root.tsx`, `_tabs.tsx`, or `games.$gameId.tsx` (layout routes), since `links` concatenate without dedup.
- `__root.tsx` keeps only sitewide defaults (charSet, viewport, `og:site_name`, `og:type: website`, WebSite/Organization JSON-LD). No `og:image`, no canonical there.
- Dynamic routes (`games.$gameId.index`, `players.$userId`, `teams.$teamId.index`, `trainers.$trainerId.index`, `orgs.$orgId`) derive title/description/`og:url`/canonical from `loaderData` where a loader exists; where the data is fetched client-side today, use a static-but-specific fallback plus params-based URL rather than adding new loaders. Add `og:image`/`twitter:image` only when the route already has an absolute https cover URL — leaf routes only, no placeholders.
- JSON-LD: `WebSite` at root, `SportsEvent` on game detail, `Person` on player profile, `SportsTeam` on team, `LocalBusiness` on gym, `BreadcrumbList` on deep routes.
- Private routes add `{ name: "robots", content: "noindex, nofollow" }`.
- New files: `public/robots.txt`, `public/sitemap.xml` (public routes only; static entries, no dynamic ids).
- No backend, data-model, or component-logic changes — head metadata and two static files only.
