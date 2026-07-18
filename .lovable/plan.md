## Goal

Give trainers (currently the "coach" tab inside `/teams`) their own dedicated page at `/trainers`, rename all user-facing "Coach/Coaches" copy to "Trainer/Trainers", and add a link to the bottom navigation bar.

Note: the underlying data model keeps `kind: "coach"` in the DB (`teams.kind`, `org-store`, etc.) so existing rows and edge cases keep working — only UI labels and the route layout change.

## Changes

1. **New route `src/routes/_tabs.trainers.tsx`**
   - Cloned from `_tabs.teams.tsx`, hard-locked to `kind = "coach"`.
   - Drops the Teams/Coaches kind switcher entirely (single-purpose page).
   - URL schema mirrors teams: `q`, `sport`, `avail`, `sort`, `view`, `density`.
   - Copy uses "Trainers" everywhere (title "Trainers & coaches.", search placeholder, empty state, create button "Create trainer profile", availability chip "Booking now").
   - Reuses `OrgCard`, `SportChips`, `TeamsMapView` (passing coach-filtered orgs). No component-level changes needed since these already handle `kind === "coach"`.
   - `head()` sets a unique title + description + og tags per project SEO rules.

2. **`src/routes/_tabs.teams.tsx`**
   - Remove the coach kind switcher and the `KIND_META.coach` branch; page becomes teams-only.
   - Simplify state: drop `kind` from the URL schema, hard-code `kind = "team"` when filtering.
   - Update `head()` title to "Teams — OpenRun".
   - Legacy `/teams?kind=coach` URLs: `validateSearch` will just ignore the extra param; no redirect needed, but we can optionally add a small `useEffect` to redirect `?kind=coach` → `/trainers` preserving other params. Included in the plan.

3. **Rename user-facing labels to "Trainer" (data key stays `"coach"`)**
   - `src/components/OrgCard.tsx`: `"Coach"` badge → `"Trainer"`.
   - `src/components/TeamsMapView.tsx`: `noun`, fallback label, and any visible copy switch from "coach" → "trainer" / "Trainer".
   - `src/routes/teams.create.tsx`, `teams.$teamId.tsx`, `teams.$teamId.edit.tsx`, `profile.edit.tsx`, `review.new.tsx`, `available-players.tsx`: swap visible "Coach"/"coach" strings to "Trainer"/"trainer" where they appear in JSX/toasts. Enum values, DB columns, and internal identifiers (`kind === "coach"`, `credentials`, `rate_per_hour`) are left untouched.
   - Sport-config, transactions, reviews, sample-data, org-store, teams.functions: leave `kind: "coach"` as the stored value.

4. **`src/components/BottomNav.tsx` — add Trainers**
   - Insert a new left-side item using the `GraduationCap` icon:
     `{ to: "/trainers", icon: GraduationCap, label: "Trainers", match: (p) => p.startsWith("/trainers") }`.
   - Left group becomes 4 items (Play, Players, Teams, Trainers); right stays 2 (Inbox, You), plus the center Host FAB. That's 7 total — tight on small phones. To keep it legible we:
     - Tighten each tab's horizontal padding (`px-1` → `px-0.5`) and icon container width (`w-14` → `w-12`) on small screens only.
     - Keep the existing `max-w-md sm:max-w-xl` container so it doesn't overflow.
   - No changes to public-path hiding logic or the FAB.

5. **Verification**
   - `tsgo` typecheck.
   - Manual: visit `/trainers` (list + map + filters + create CTA), verify `/teams` no longer shows the kind switcher, confirm `/teams?kind=coach` redirects to `/trainers`, confirm bottom nav shows the new tab and highlights it on `/trainers`.

## Out of scope

- Renaming the DB column or `OrgKind` union from `"coach"` to `"trainer"` (would require a migration and a wide refactor; deferred).
- Redesigning `OrgCard` for trainer-specific fields — existing coach branch already handles rate/credentials.
