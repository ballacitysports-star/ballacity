# Make the gym listing action buttons work reliably

The Directions / Call / Website / Email / Share row on a gym page mostly works, but there are real gaps in the link-building helpers that break it for common data. Confirmed from the code and this gym's saved data (address `123 city`, no coordinates, phone `6783410221`, website `http://google.com`, email present).

## Issues to fix

1. **Website can navigate to the wrong place.** The button uses the stored value verbatim. Only the gym editor enforces `http(s)://`; any value saved earlier or imported without a scheme (e.g. `google.com`) becomes a relative link and sends the user to `/orgs/<id>/google.com` instead of the site.
2. **Directions can produce an empty destination.** The button shows whenever an address *or* a coordinates object exists, but if the coordinates object is present with missing lat/lng and the address is blank, the Google Maps link is built with `destination=` empty and lands on a useless page.
3. **Call link mangles some numbers.** Digits are stripped down in a way that keeps a stray `+` from anywhere in the string and drops extensions; very short/garbage numbers still render a dead Call button.
4. **Email isn't sanitized.** Whitespace or an obviously invalid value still renders a Mail button that opens a broken compose window.
5. **Share fails silently.** If the native share sheet is unavailable and the clipboard API is blocked (non-secure context, permissions), the catch block swallows everything and the user gets no feedback at all.

## What changes

Helpers in `src/lib/org-listing.ts`:
- Add `websiteHref(value)` — trims, prepends `https://` when no scheme, rejects non-http(s) schemes, returns `null` when unusable.
- Harden `telHref` — keep a leading `+` only, strip separators, preserve extension as a `;ext=` suffix; add `isDialable(value)`.
- Add `emailHref(value)` — trim + basic shape check, `null` when invalid.
- Harden `directionsHref` — return `null` when there is no usable destination (no non-empty address and no numeric lat/lng pair); prefer coordinates when both are available, keep `destination_place_id` when present.

`src/components/org/OrgListingHeader.tsx`:
- Render each action button only when its helper returns a usable href (Directions, Call, Website, Email) — this applies to both the button row and the detail rows below it, so the phone/website rows use the same normalized hrefs.
- Share: try native share, then clipboard, then a last-resort text-selection copy; show a success toast on any copy path and an error toast when every path fails. Ignore user-cancelled shares (no error toast).

Tests in `src/lib/org-listing.test.ts`: cases for scheme-less and `javascript:` websites, `+1 (678) 341-0221 x12`, blank/invalid email, and directions with address-only, coords-only, place-id, and no-destination inputs.

No database or schema changes; presentation and link-building only.
