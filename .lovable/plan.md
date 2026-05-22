## Goal
Add a complete team/coach profile creation flow so users can register new organizations from within the app.

## Current State
- Teams page (`/teams`) has a non-functional `+` button.
- Org detail pages (`/teams/$teamId`) exist with rich profiles, posts, and games tabs.
- Game creation (`/create`) already has a polished multi-section form pattern to follow.
- The `Org` data model and `OrgCard`/`PostCard` components are ready.

## Plan

### 1. Route & Navigation
- Create route `/teams/create` (under `_tabs` layout).
- Wire the `+` button on `/teams` to navigate to `/teams/create`.
- Add a "My orgs" section on the `/profile` page with a CTA to create one.

### 2. Multi-Step Wizard (`/teams/create`)
Build a 4-step creation wizard following the existing dark neon form aesthetic:

**Step 1 — Choose type**
- Big visual cards: "Team / Club" vs "Coach / Trainer"
- Brief copy explaining each

**Step 2 — Identity & basics**
- Name, handle (`@`), tagline, city
- Sport(s) selection (multi-select chips from existing `SPORTS` data)
- Year founded

**Step 3 — Details (conditional)**
- **Team:** League name, home court/venue, staff list (name + role), win-loss record (optional)
- **Coach:** Credentials (tag input), hourly rate slider, years experience
- Bio textarea (shared)
- Achievements (tag input, shared)

**Step 4 — Branding & preview**
- Accent color picker (preset neon swatches matching the design system)
- Avatar initials (auto-generated from name, editable)
- Cover image selection (reuses existing sport images as presets)
- Live preview of the `OrgCard` as you edit

### 3. Submission & State
- On submit, append the new org to an in-memory list (no backend yet; sample-data pattern).
- Navigate to the new org's detail page (`/teams/$teamId`).
- Show a success toast/animation.

### 4. Profile — "My Orgs" Management
- Update `/profile` to show a "My Organizations" section listing orgs the user created.
- Each org shows quick stats (followers, posts count) and an "Edit" button (future scope: stub).
- If no orgs, show an empty state with a create CTA.

### 5. Component Reuse
- Reuse `Section` and `Toggle` patterns from `src/routes/_tabs.create.tsx`.
- Use existing `SPORTS` chips style and `OrgCard` for live preview.
- Keep all new components in `src/components/` if shared, or inline in the route if single-use.

## Out of Scope (for this plan)
- Backend persistence / database (follows existing sample-data pattern).
- Image upload for cover/avatar (use preset sport images + color initials).
- Edit org flow after creation.
- Verification badge logic.

## Success Criteria
- A user can tap the `+` on `/teams`, complete the 4-step wizard, and immediately see their new org profile at `/teams/$teamId`.
- The creation UI matches the existing Court Neon aesthetic and mobile-first patterns.
- The `/profile` page shows the user's created orgs.
