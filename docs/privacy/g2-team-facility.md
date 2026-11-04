# G2: a youth team's practice and facility details are confidential

## Problem

`teams.home_court`, `venues`, `venue_addresses`, `primary_venue` and `venue_geo` were readable by every signed-in account for any non-hidden team. For a youth team these are where children practise. (Anonymous visitors already could not read them.)

## Policy implemented

- **Confidential team locations:** teams of kind `team` that are youth (age group youth/teen, any member not a confirmed adult, or an unknown team: fail closed). Their facility details move to `team_facility_private` (readable by the team's owner, managers and members, verified guardians of members, and moderators). With the shared guarded one-way switch ON, the public columns are empty (`NULL`, `{}`, `[]`); the city stays public.
- **Intentionally public business venues:** teams of kind `coach` (trainers, gyms, facilities) are never touched, even if they list a youth age group. A youth team that plays at an intentionally public venue can be marked public only by a moderator after verification (`verify_team_facility_public`); a manager can request review (`facility_public_requested`); a trigger reverts any other write to `facility_public`; changing the facility clears it; a moderator can revoke it. Verification is recorded in `team_public_facilities` (service role only).
- **Edits:** the private copy is updated per changed column, so a partial edit cannot replace a private value with an empty one. Removing a detail is explicit (`clear_team_facility_details`, managers only) because writing an empty value cannot be told apart from a client sending back the empty public value.
- **Rollout:** with the switch OFF the migration changes no visible behaviour (it adds the private copy, guards and tools). Activation requires a private copy for every affected team (a second guard on the shared switch); `coarsen_existing_youth_team_facilities(n)` empties existing rows in batches.

## Application

`org-store` loads the private row with the viewer's own session and fills in the empty columns (after hydrate and after each save), so a manager keeps seeing and editing the real venue; a removal calls `clear_team_facility_details`. Unentitled viewers get the public (empty) values.

## Compatibility

Old app on the new database after activation: a manager on an old build sees no venue until the app is updated (no exposure; saving from that build would send empty values, which the trigger treats as no change, so private details are not lost). New app on the old database: the overlay query fails, the public (exact) values are used as before.

## Recovery

Nothing restores facility details into public columns except a moderator's verification of a public facility. A wrong private copy is corrected by the service role with approval and the manager re-saves. Fixes to the trigger go forward in a new migration. `docs/rollbacks`-style removal is not provided: dropping the triggers would re-open nothing by itself (public columns stay empty), but the private data would stay hidden; restore flows go through the manager UI.

## Residual

Maps or search results built from `venue_geo` for other users no longer show youth teams' practice venues (intended). Facility details already seen or cached on devices before activation cannot be recalled (see G5). Free-text elsewhere (bio, tagline, achievements) can mention a venue; the PRIV-2D detector is not applied to team profiles in this change.

## Tests

`supabase/tests/380_team_facility_privacy.test.sql` (61 assertions): switch OFF changes nothing visible; adult team and a youth-age-group trainer listing untouched; activation refused until every affected team has a copy; batch + idempotence; anonymous (no column privilege, no private access), adult and teen strangers, member of another team, revoked guardian (no); owner, coach, teen and under-13 member, verified guardian, moderator, administrator (yes); partial edit keeps other private values; NULL write is a no-op, explicit clear works and is manager-only; public-facility policy (request, direct write reverted, moderator-only verify/revoke, record, stranger sees it, moving clears it, revoke re-hides); a new youth team created while ON; realtime and grants. Unit tests for the overlay helpers.
