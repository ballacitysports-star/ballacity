## Goal
Give trainers (`org.kind === "coach"`) a dedicated profile page tailored to their offering — bio, specialties, credentials, verified experience, session types, rate, and clear Contact / Book CTAs — instead of reusing the team page shell.

## New route

**`src/routes/trainers.$trainerId.tsx`** — new file.
- `createFileRoute("/trainers/$trainerId")` with `validateSearch` for `tab` (about | experience | reviews), `modal` (reviews).
- `loader`: `ensureOrgById(params.trainerId)`; if not found or `org.kind !== "coach"`, throw `notFound()`.
- `head()`: `"{trainer name} — OpenRun"`, description from bio, og:image from `org.cover`.
- `errorComponent` / `notFoundComponent` linking back to `/trainers`.

### Page structure
1. **Cover + header**: cover image, back button, avatar/initials, name, `@handle`, `ShieldCheck` verified badge, city, primary sport chips, `ReputationBadge` (trainer variant).
2. **Sticky CTA bar** (mobile-first, `sticky bottom-16 z-30`):
   - Primary: **Book a session** → opens `BookSessionSheet` (see below).
   - Secondary: **Message** → navigates to `/inbox?to={org.ownerUserId ?? org.id}`.
   - Tertiary icon: Share (Web Share API + clipboard fallback), Follow toggle (reuse `useFollow` when `org.ownerUserId` exists; otherwise hidden).
3. **Tabs**: About · Experience · Reviews.
4. **About tab**:
   - **Bio** (`org.bio`).
   - **Specialties**: derived from `org.sports` + `org.sessionTypes`, rendered as lime pill chips.
   - **Credentials**: `org.credentials` as verified chips with `ShieldCheck`.
   - **Rate**: `org.ratePerHour` shown as "$X / hr" card with `DollarSign` icon (hidden when null).
   - **Location**: `org.city` + map preview link.
5. **Experience tab** ("verified games/experience"):
   - **Achievements**: `org.achievements` list with trophy icons.
   - **Verified games hosted**: from `GAMES.filter(g => g.hostOrgId === org.id)` (or `org.upcoming` + past games) rendered with `GameCard`, each with a small "Verified host" badge when the game is completed.
   - **Stats strip**: sessions completed (count of past games), avg rating, response rate (placeholder from `orgRep`).
6. **Reviews tab**: `<ReviewsSection revieweeId={org.id} revieweeKind="trainer" />` — same infrastructure as team page.

### Book / Contact sheet
**`src/components/BookSessionSheet.tsx`** — new client component.
- Bottom sheet (reuse existing `Sheet` primitive) with fields: session type (from `org.sessionTypes`), preferred date, duration, message.
- Submit calls existing `availability_contact_requests` insert path (reuse whichever helper drives player contact requests — trace `availability_contact_requests` inserts and reuse; no schema change).
- On success: toast + close.

## Navigation updates (route trainers instead of teams for coaches)

- **`src/components/OrgCard.tsx`**: when `org.kind === "coach"`, link to `/trainers/$trainerId`; teams keep `/teams/$teamId`.
- **`src/components/TeamsMapView.tsx`**: same split for pin `to`.
- **`src/routes/_tabs.trainers.tsx`**: any list item links go to `/trainers/$trainerId`.
- **`src/routes/teams.$teamId.tsx`**: in the loader, if `org.kind === "coach"` redirect to `/trainers/$trainerId` (preserve back-compat for existing shared team URLs).
- Edit link for owner still points at `/teams/$teamId/edit` (single edit flow, unchanged).

## Out of scope
- No schema changes; existing `teams` table + `org.kind === "coach"` remains the source of truth.
- No changes to the create wizard or the edit page.
- Follow / block / report menus reuse existing components as-is.

## Technical notes
- File path uses TanStack flat convention: `trainers.$trainerId.tsx` → `/trainers/$trainerId`, matching filename ↔ route rule.
- `head()` reads `loaderData` for title/description/og:image; falls back to generic strings when `loaderData` is undefined (notFound path).
- All colors via semantic tokens (`bg-surface`, `text-lime`, `border-border`, `bg-lime-gradient`, `glow-lime`). No hardcoded hex.
- Reuse `Section` helper pattern from `teams.$teamId.tsx` (or extract to `src/components/Section.tsx` if used across both — extract only if cleanly generic).