# Team event calendar

- Add Calendar/List views to the existing Tryouts & camps page, keeping create, edit and delete actions.
- Show a navigable month with event markers; selecting a day shows its announcements, RSVP totals, available spots and signed/missing waivers.
- Include monthly totals, a Today control, undated events and clear loading/error/empty states. Keep the layout usable on small screens.

## Technical approach
- Reuse the existing manager-authorized roster overview for RSVP and current published-waiver status; refresh every 20 seconds and after event changes.
- Reuse date utilities and design-system buttons. No database or participation-rule changes.
- Verify calendar navigation, date grouping and rendering; report any real-account testing limitation.
