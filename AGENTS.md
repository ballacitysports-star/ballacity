# Project Architecture Rules

- Guardian-to-team contact discovery must verify the guardian-child relationship and the child's team membership on the server before returning leader identities, because roster UI visibility is not an authorization boundary.
- Team event calendars reuse the manager-authorized roster overview for RSVP/current-waiver summaries and shared date-key utilities for grouping, avoiding duplicate permissions or participation logic.