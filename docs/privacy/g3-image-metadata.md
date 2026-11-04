# G3: image metadata (EXIF / GPS) is removed on the server

## Problem

Phones write the GPS position, camera, time and sometimes the owner into JPEG, PNG and WEBP files. Uploads reached storage with those tags intact: only chat pictures over 300 KB were re-encoded by the browser, game covers and profile images were stored as sent, and a direct upload skips the browser anyway.

## What changed

- `src/lib/image-metadata.ts` rewrites the bytes of a JPEG, PNG or WEBP without personal metadata and without decoding or re-encoding, so the picture is identical. Removed: EXIF (GPS, camera, timestamps, embedded thumbnail), XMP, IPTC/Photoshop blocks, comments, PNG text chunks and modification time, unknown ancillary chunks. Kept: pixel data, palette, transparency, gamma, ICC profile, animation chunks and **only the EXIF Orientation tag**, so phone photos still display upright.
- `finalizeImageUpload` (every image bucket) strips the stored object and writes the clean bytes back over the same path **before** the safety scan, the resize/variant warm-up and the moderation record, so no thumbnail or derivative is ever made from the original. If the file cannot be cleaned the object is removed and the upload refused (fail closed).
- `finalizeMessageAttachment` does the same for chat pictures of any size (previously only large ones were re-encoded by the browser).
- Read-only assessment and a guarded clean-up for images stored earlier: `superadminScanImageMetadata` (counts and bucket/path of images that carry tags; never coordinates or tag values) and `superadminStripStoredImages` (dry run unless explicitly turned off; audited).

## Not covered (stated plainly)

- Payment-proof screenshots (private to host and payer), and video: not touched. Child reel clips already go through a separate location-removal step in the browser.
- A copy that a browser or CDN fetched between upload and finalize (the finalize call is made immediately and the URL is returned only afterwards) and copies already on devices cannot be recalled.
- The stripper handles the formats the app accepts (JPEG, PNG, WEBP). Anything else is already refused by validation.

## Compatibility

- No schema change, no migration. Orientation is preserved, verified on the repository's real EXIF fixtures (`e2e/fixtures/exif/o1,o3,o6,o8.jpg`) and on synthetic PNG/WEBP.
- The `image_moderation.scan` JSON gains `metadata: { stripped, hadGps, hadExif, hadXmp }` (booleans only). `finalizeImageUpload` additionally returns `metadataStripped`. Old clients ignore both.
- Cache: the clean object is written with `cacheControl: 3600` (shorter than before for public buckets). A previous long-cached copy can exist only if someone fetched the URL before finalize, which the app does not expose.
- Staged rollout: server code only. Deploying it before or after any database change is safe.

## Assessing and cleaning existing media (needs the owner's approval for each production run)

1. `superadminScanImageMetadata({ buckets, limit, offset })` page by page; record `withGps`, `withExif`, `withXmp`, `perBucket` and the `flagged` list.
2. `superadminStripStoredImages({ items, dryRun: true })` over the flagged items to confirm `would_strip`.
3. With written approval: the same call with `dryRun: false` and a `reason`; each run is audited. Re-run the scan to confirm `withGps = 0`.
4. Objects a person deletes later are not recoverable from this tool; the clean copy replaces the original in place. Take a restricted backup of the affected objects first if the owner wants an undo (the originals contain the data being removed).

## Recovery

- If a legitimate image is refused ("could not be processed"), the upload failed closed: the user retries with another photo; fix the stripper in a new change. The stripper never publishes the original.
- If stripping ever corrupts a format, set the finalize call back to the previous behaviour only with the owner's approval and a recorded reason; never skip stripping for the buckets that hold images of children or youth teams.
- Nothing here restores metadata to any object.

## Tests

`src/lib/image-metadata.test.ts` (12) and `src/lib/image-metadata.server.test.ts` (4): GPS/EXIF/XMP/IPTC/comment removal in JPEG, PNG and WEBP; orientation kept; idempotence; malformed input throws; real EXIF fixtures keep dimensions and orientation; write-back path and fail-closed behaviour; scan counts carry no values. A mutation check (keeping the EXIF segment) fails five of them.
The superadmin functions rely on `assertSuperadmin` (the same check as the existing image moderation functions); there is no SQL in this change, so no SQL authorization test applies.
