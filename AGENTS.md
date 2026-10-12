# Project Architecture Rules

- Guardian-to-team contact discovery must verify the guardian-child relationship and the child's team membership on the server before returning leader identities, because roster UI visibility is not an authorization boundary.
- Team event calendars reuse the manager-authorized roster overview for RSVP/current-waiver summaries and shared date-key utilities for grouping, avoiding duplicate permissions or participation logic.- Reel pose tracking runs only in the browser (adults/16-17, never family clips) and stores only the summarized PoseMetrics in media_meta.pose, because raw landmarks are biometric data that must never leave the device.
