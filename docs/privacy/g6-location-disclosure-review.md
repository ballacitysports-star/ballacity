# G6: review handling for location disclosures the detector cannot identify

## Position

The PRIV-2D text detector refuses an address, map link, coordinates, unit or the venue name in the public text of a game or team post. It is a **heuristic, not a security boundary**: it cannot see paraphrases ("park across from the green gate"), landmarks or hints. The safeguards that do not depend on it are the database rules that keep the exact venue out of public columns; the text the host types stays public to signed-in users. This change adds the human path for what the detector misses, and does not present the detector as complete.

## What was added

- **A report reason**, `location_disclosed` ("Reveals a private location (address, map link or landmark)"), in the existing game report dialog and moderator queue. No new screen.
- **Automatic precaution after two independent reports.** When two different people report the same game that may include children (a game with no age limit counts), its free text (title, description, neighborhood, rules, equipment, cancellation text) is removed, the host gets a generic notice, the open reports are marked `actioned`, and the event is written to `admin_audit_log`. **No copy of the removed text is kept**, so the audit trail does not become a second copy of the disclosure. The host can describe the area again; the PRIV-2D guard applies to what they write.
- **One report never changes a listing**, so a single person (or a rival) cannot blank a game. The same person reporting twice counts once. Reporters are never shown to the host (the host cannot read `user_reports` rows of others).
- **Moderator tools:** `moderator_scrub_game_text` (one report is enough, audited, closes the open reports), `moderator_scrub_team_post_text`, and `list_team_posts_with_location_text()` to scan posts of youth-age-group teams, alongside the existing `list_youth_games_with_location_text()`. Moderators and administrators only; anonymous and ordinary users are refused. Hiding a listing continues to use the existing moderation tools.

## Operating it

1. Moderators work the existing report queue; reports with this reason are the privacy queue.
2. Weekly (and before activation of coarsening) run both scan functions and handle every hit; the runbook's V6 query must return 0.
3. After removal, check the listing and ask the host to re-add area-level text; escalate repeat disclosures through the normal host-conduct process.

## Limits

- Two reporters are needed for the automatic step, so a listing with one report waits for a moderator. Between a disclosure and review, the text is visible to signed-in users.
- Team posts can be scanned and scrubbed by a moderator but are not reportable through the user report dialog (it has no team-post subject); a family can report the team instead.
- The scan only finds what the detector finds. Someone must still read reports.

## Compatibility

Constraint change on `user_reports.reason` (adds a value); new trigger and functions; no data is rewritten. Old clients cannot send the new reason (nothing breaks). New client on an old database: choosing the new reason would be rejected by the old constraint with an error message; deploy the migration first (the usual order).

## Recovery

The trigger can be fixed forward in a new migration. Scrubbed text cannot be restored from the system by design; the host re-enters it. Disabling the automatic step means dropping `zz_location_disclosure_report_trg` (leaves the moderator tools); that needs the owner's approval and a recorded reason.

## Tests

`supabase/tests/390_location_disclosure_reports.test.sql` (37): reports from adult and teen reporters; one report changes nothing; the same person twice changes nothing; two independent reporters remove the text, notify the host without repeating it, close all reports and audit without keeping a copy; the host cannot read reports; the host's rewrite with an address is refused and an area description is accepted; an adult-only game is left alone; moderator and administrator can scrub, members and anonymous callers are refused; team-post scan and scrub; grants. No SQL authorization is bypassed by the helper functions (not callable by API roles).
