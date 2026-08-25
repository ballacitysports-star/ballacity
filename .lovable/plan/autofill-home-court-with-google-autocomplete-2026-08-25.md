# Autofill home court with Google autocomplete

Today the "Home court / venue" field on team profiles is a plain text box, so venue names are typed by hand and vary wildly. The city and gym address fields already use the app's Google-backed location picker; this brings home court in line with them.

## What changes

- In the team creation wizard and the team edit screen, the "Home court / venue" input becomes the same Google location picker used elsewhere: type two or more characters, see venue suggestions, tap one to fill the field with the full venue name and address.
- Typing a venue manually still works — suggestions are optional, and the field falls back gracefully if suggestions can't load.
- The "use my current location" affordance stays off for this field, since a home court is a named venue rather than "where I am right now".
- Placeholder stays venue-oriented (e.g. "Tompkins Square Courts").

## Technical notes

- Replace the raw `<input>` in the `Home court / venue` section of `src/components/CreateOrgWizard.tsx` and `src/components/EditOrgScreen.tsx` with `<LocationAutocomplete mode="place" showCurrentButton={false} value={homeCourt} onChange={setHomeCourt} />`.
- No data model change: `homeCourt` / `home_court` stays a plain string, so existing saves, autosave, and the team page display are untouched.
- No new server code: `LocationAutocomplete` already calls the existing `autocompletePlaces` / `getPlaceDetails` server functions through the Google Maps connector gateway.
