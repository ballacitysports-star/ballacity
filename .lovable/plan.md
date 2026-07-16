## Goal
Make the profile page clearly separate the three activity sections: **Pending Approvals**, **Hosting**, and **Pickup (Playing)**. Each section should be visually distinct and scannable at a glance, while staying within the existing PS Blue on Ink dark aesthetic.

## Current State
- The profile page has a single "Pending approvals" section with an inner tab filter (All / Host actions / My sent requests).
- Below it is a single "Upcoming games" section that internally splits into **Hosting** and **Playing** sub-sections.
- The visual treatment is a flat stack of gray cards; the section headers are small, muted, and easy to skim past.

## Proposed Changes

### 1. Section header redesign
Give each of the three primary sections a strong, sticky-at-a-glance header with a color-coded icon badge:

- **Pending Approvals** — coral/orange urgency tone (`text-coral`, `bg-coral/10` border) with a clock icon and a live count badge.
- **Hosting** — electric PS blue/primary tone (`text-lime`, `bg-lime/10` border) with a shield/crown icon.
- **Pickup / Playing** — success/lime tone (`text-lime`, `bg-lime/10` border) with a trophy/runner icon.

Each section header will live on a slightly raised surface (`bg-surface-2` rounded shell) with a subtle top border and shadow to define its boundary.

### 2. Section containers
Wrap each section in a `rounded-3xl border border-border bg-surface p-4` shell. This creates a "drawer" or panel effect that separates the content from the rest of the profile.

Add a thin, theme-aware divider between sub-sections when both Hosting and Pickup exist inside the same activity panel.

### 3. Move Hosting & Pickup to top-level sections
Split the current "Upcoming games" block into two distinct top-level sections:

- **Hosting** — games where `hostUserId === profileUser.id`.
- **Pickup** — games where the user is joined but not the host.

Remove the generic "Upcoming games" header.

### 4. Pending section layout
- Keep the existing tabs (All / Host actions / My sent requests) but place them inside the Pending section shell.
- Move the count badge into the section header instead of the sub-title.
- Use an `EmptyRequestsState` that matches the narrower, contained panel width.

### 5. Spacing and rhythm
- Add `mt-8` between major sections (currently `mt-6`) to increase visual breathing room.
- Keep section internal gaps at `space-y-3` or `space-y-4`.
- Ensure the mobile bottom nav padding `pb-28` is preserved.

### 6. No functional changes
All data, logic, tabs, and interactions remain the same. Only layout, styling, and labels are adjusted. Existing states (loading, empty, error) still render within the new section shells.

## Files to edit
- `src/routes/_tabs.profile.tsx` — restructure and style the Pending, Hosting, and Pickup sections.

## Verification
- Open `/profile` on desktop and mobile widths.
- Confirm:
  - Three clearly separated sections with distinct headers/colors.
  - Pending tabs still filter correctly.
  - Hosting and Pickup games appear in the correct panels.
  - Empty states still render properly when there are no items.