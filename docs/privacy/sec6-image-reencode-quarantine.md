# SEC-6 (Approval D): image re-encoding and restricted quarantine

Status: **implemented on branch `claude/sec6-image-reencode`, based on the r4 integration candidate (c637ec5e, which contains #268 at 9833cf61). Not merged, not applied to any Supabase project, not verified on real Storage.** One release blocker is open: see [Runtime](#runtime-release-blocker).

This closes the findings left open by the final review of #268 (`docs/privacy/g3b-image-staging.md`, "Still open after the final review"):

| Finding                                                                                                                                                                                                                 | Fix here                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M2**: the byte stripper copies data that can carry a payload (ICC/APP2, the tail before a JPEG EOI, duplicate PNG/WEBP chunks, extra IDAT, unchecked CRCs), including a whole second image the safety scan never sees | Every published image is decoded and re-encoded by `src/lib/image-reencode.server.ts` (sharp/libvips). The scan runs on the re-encoded bytes and exactly those bytes are published.                                                                                               |
| **M4**: a chat attachment flagged for child safety was deleted before it was escalated                                                                                                                                  | Flagged originals (chat attachments, staged uploads, legacy direct uploads) are copied to a private, service-only quarantine bucket and recorded, then escalated with that reference, and only then removed from where they were uploaded. If the copy fails, nothing is deleted. |
| **L1**: account purge and data export skipped `image-staging`                                                                                                                                                           | Purge removes the user's staged files except originals under legal hold; export lists the user's staged files (metadata only), leaving out files held for a safety review.                                                                                                        |
| Requirement 6: signed upload tokens must not replace published or already-scanned bytes                                                                                                                                 | New trigger `published_image_refuse_user_write` on `storage.objects` covers the eight destination buckets, built on #268's `storage_write_is_trusted`.                                                                                                                            |

## Pipeline (published images)

`promoteStagedImage` (new clients) and `finalizeDirectImageUpload` (legacy clients, retired with phase 2) both run:

1. **Private staging.** The browser writes the original to `image-staging` (private, own folder only; unchanged from #268).
2. **Validate the original**: sniffed type JPEG, PNG or WEBP; at most 8 MB; 64 to 6000 px per side and at most 30 MP by the header; the file name's extension matches the sniffed type.
3. **Structural pre-check** with the byte stripper (`stripImageMetadata`), see [below](#why-the-byte-stripper-stays).
4. **Decode and re-encode** with sharp: pixel cap (`limitInputPixels` = 30 MP), decoder errors are fatal (`failOn: "error"`), single frame only. The orientation is applied to the pixels (`autoOrient`), colours are converted to 8-bit sRGB through the embedded profile, the result is taken as **raw pixels**, and a new file is encoded from those pixels alone. Going through raw pixels matters: without it libvips carries values such as the PNG `pHYs` resolution (9 uploader-chosen bytes) into the output; a unit test caught exactly that.
5. **Verify the output**: same type, the expected (oriented) dimensions, one frame, no EXIF/ICC/XMP/IPTC/orientation according to the decoder, and nothing the byte inspector would strip. The promotion re-validates type, size and dimensions independently.
6. **Scan exactly these bytes** (inline up to 4 MB; above that from a server-only `_scan/...` copy of the same bytes, as in #268).
7. **Publish exactly these bytes** with the service key, or, if flagged, move the original to the quarantine.

Every failure publishes nothing. Re-encode results by case:

| Case                                                                      | Result                                                                                                  | Message shown to the uploader                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GIF, TIFF, AVIF, HEIC, SVG, BMP, anything not JPEG/PNG/WEBP               | refused; staged file removed and recorded                                                               | "Only JPG, PNG or WEBP images are allowed"                                                    |
| Animated WEBP or APNG                                                     | refused (all destination buckets, as before)                                                            | "Animated images can't be used here. Please choose a still JPG, PNG or WEBP picture."         |
| More than 30 MP (decompression bomb), by header or by sharp's pixel limit | refused before decoding                                                                                 | "Image resolution is too high"                                                                |
| Corrupt, truncated, structurally invalid, or output fails verification    | refused                                                                                                 | "This image could not be processed. Please try a different photo."                            |
| sharp cannot load (no native module in the runtime)                       | **held**: nothing published, the original stays private and hidden from its uploader (status `pending`) | "Image processing unavailable" (promotion, retryable); legacy direct path removes and refuses |

### Format matrix

The output type is always the input type. The client names the destination with the extension of the type it uploaded and builds the URL from that name, so changing the type would change the contract with every existing client; a photo arrives as JPEG (the client compresses photos to JPEG) and an image with transparency arrives as PNG or WEBP, so "JPEG for photos, PNG/WEBP for transparency" holds without converting between types.

| Input                                                     | Output                 | Encoder settings                                                         | Transparency                 | Notes                                                                                                |
| --------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| JPEG (baseline/progressive, any colour space, CMYK)       | JPEG baseline          | quality 85, chroma 4:2:0, optimised Huffman, no mozjpeg, not progressive | none (JPEG has none)         | Generation loss: one re-encode at q85. Visually transparent at the sizes the app shows.              |
| PNG (any bit depth, palette, grey, with or without alpha) | PNG, 8-bit RGB or RGBA | lossless, zlib level 9, adaptive filtering, no palette quantisation      | kept exactly                 | 16-bit input becomes 8-bit; grey becomes RGB; palette becomes truecolour (bigger file, same pixels). |
| WEBP lossless (VP8L)                                      | WEBP lossless          | lossless, effort 4                                                       | kept exactly                 | Pixel-identical (test).                                                                              |
| WEBP lossy (VP8, optional ALPH)                           | WEBP lossy             | quality 85, alpha quality 100, smart subsampling, effort 4               | kept (alpha at full quality) |                                                                                                      |
| Anything else                                             | refused                |                                                                          |                              |                                                                                                      |

For every output: **orientation** is applied to the pixels and no orientation tag is written; **colour** is converted to sRGB through the embedded ICC profile when there is one (Display P3 phone photos included; out-of-gamut colours are clipped), and **no ICC profile is embedded**, which means "sRGB" to every browser; **no EXIF, XMP, IPTC, comments or text chunks** are written. The only container data the output has is what the encoder writes for itself: JPEG quantisation/Huffman tables, frame and scan; PNG `IHDR`, `pHYs` (the encoder's default 72 dpi, not the upload's), `IDAT`, `IEND`; WEBP `VP8X`/`ALPH`/`VP8 ` or `VP8L`. Settings are fixed constants (`REENCODE_SETTINGS`), so the same upload always yields the same bytes (a retry republishes identical bytes).

### Why the byte stripper stays

It is kept as a **structural pre-check**, not as the thing that cleans what is published:

- It refuses malformed containers (no EOI, second SOI, bad table lengths, unknown critical PNG chunks, no image data) **before a native decoder parses them**, which narrows libvips' attack surface.
- The decoder reads the stripper's **output**, so EXIF maker notes, XMP, IPTC and text chunks never reach a native parser. The stripper keeps only the ICC profile (needed for the colour conversion) and writes an orientation-only EXIF block of its own; the re-encoder checks that sharp sees the same orientation the stripper reported and refuses otherwise.
- It is the APNG detector: libvips' PNG loader reports an APNG as a single page.
- Its report (had GPS/EXIF/XMP) is recorded on the moderation row, counts only.

None of its output is published: the re-encoder writes a new file from pixels.

### Residual

- Pixels can encode anything a picture can (steganography); no re-encoder removes that, but lossy JPEG/WEBP re-encoding destroys most low-bit payloads, and nothing outside the pixels survives.
- One generation of JPEG loss per published photo (q85). Measured on the repo's fixtures: mean absolute error under 4/255 on the sport photos.

## Published paths: no user write over scanned bytes (requirement 6)

Migration `20261108120000_image_quarantine_reencode.sql` adds `published_image_refuse_user_write` (BEFORE INSERT OR UPDATE on `storage.objects`) for `avatars`, `covers`, `org-avatars`, `org-covers`, `team-avatars`, `team-covers`, `trainer-avatars` and `game-covers`. Once the server has processed a path (it has an `image_moderation` row: published, quarantined or removed), only a trusted writer (#268's `storage_write_is_trusted`: the service key with no end-user owner, a superuser, or service code with the transaction flag) may write at that path again. Refused: the owner's own API update through the legacy own-folder policy, a move onto or off the path, re-inserting at the path after a delete, and Storage's own write for a user's signed upload URL with upsert (it runs as the service role with the signer stamped as owner). Not changed until phase 2: an older client can still upload a **new** file in its own folder, and change it while the server has never processed it; the server's legacy finalize claims the path (a `pending` moderation row) **before** it rewrites the object with the re-encoded bytes, so from that moment the uploader cannot replace it.

## Quarantine

### Storage and records

- Bucket `image-quarantine`: **private** (Storage serves no public URL for it), JPEG/PNG/WEBP, 20 MB. No permissive policy; a RESTRICTIVE policy for `anon` and `authenticated` on every command keeps it closed even if a broad permissive policy is added later (test 520 injects one). Trigger `image_quarantine_guard`: only the service key writes; **no role, including the service role and a superuser, may change an object's bytes or name**; a delete is refused unless the item's record allows it (no legal hold and retention ended). An object without a record (the record insert failed) is kept for manual reconciliation.
- Paths are `{source}/{uuid}.{ext}`, not keyed by user, so a user-folder listing (purge, export, sweeper) never reaches them.
- `public.image_quarantine_items`: source, source bucket and path, uploader, conversation (chat), MIME, size, **SHA-256 of the original**, classifier categories, suspected-CSAM flag, status (`held`, `reported`, `cleared`, `destroyed`), legal hold, retain-until, report reference. Superadmins read the metadata; only the service role writes; a record is never deleted (destruction is a status) and its identity fields are immutable. `uploader_id` deliberately has no foreign key: evidence under legal hold outlives the account.
- The quarantined copy is the **original as uploaded** (metadata included), because that is the evidence; it is never published and never shown to the uploader.

### Flows

| Source                                 | On a flag                                                                                                                                                           | If the quarantine copy fails                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Staged upload (`promoteStagedImage`)   | copy original to quarantine, record, mark the staging row `quarantined` with the reference, escalate (CSAM) with the quarantine path, remove the staged copy        | the staged original stays in `image-staging` (private, hidden from its uploader, never swept), escalated there |
| Chat attachment (`finalizeAttachment`) | copy original to quarantine, record (with the conversation), escalate (CSAM) with the quarantine path, remove the attachment; no check row, so it can never be sent | the attachment is **not** removed; it has no check row, so it can never be sent; escalated at its path         |
| Legacy direct upload                   | copy original to quarantine, record, mark the public row `quarantined`, escalate (CSAM), **remove the public object** (it no longer has a public URL)               | the object stays (hidden app-wide by its status) and is escalated where it is                                  |

Non-CSAM flags (e.g. violence) are quarantined the same way, without the child-safety escalation.

### Reviewer access

Only through `superadminReviewQuarantinedImage` (server function), which:

1. calls `request_quarantine_review(item, reason)` **with the reviewer's own client**: SECURITY DEFINER, superadmins only, a reason of at least 10 characters, writes an append-only audit row (`image_quarantine_access_log`), returns a single-use grant valid for 2 minutes;
2. calls `consume_quarantine_review(grant)` with the service role (no API role can execute it): re-checks the role, stamps the grant used, returns the path;
3. signs a **60-second** URL with the service key.

SQL cannot sign a Storage URL (the signing key is not in the database), hence the two steps. The browser never holds anything that can list or read the bucket. Decisions go through `update_quarantine_item(item, action, reason, reference)`, superadmins only, audited: `mark_reported` (requires the CyberTipline report reference), `place_hold`, `release_hold`, `clear`.

## Retention, access control and escalation procedure

> **Needs counsel review before release.** The periods and the reporting steps below are engineering defaults chosen to be conservative. They are not legal advice. Items marked **(counsel)** must be confirmed or changed by counsel, and the database defaults changed to match.

**Who can access**

- Uploaders: never (not their quarantined original, not its record).
- Moderators: no. Only users with the `superadmin` role, and only one original at a time, through the audited flow above. **(counsel / owner)** Recommended next step: a dedicated, smaller `safety_reviewer` role instead of all superadmins.
- Server code (service role): writes, never reads for display; destroys only what the database allows.
- Nobody through a public URL: the bucket is private.

**How long files are kept**

| What                                                                                     | Kept                                                                                                                                                                                                         | Enforced by                                                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Unflagged staging leftovers (abandoned, held, failed)                                    | up to 24 h, then the manual sweeper removes them (unchanged)                                                                                                                                                 | `superadminSweepImageStaging`                                                                    |
| Quarantined original, not suspected CSAM                                                 | at least 90 days from quarantine, then destroyed by `superadminSweepExpiredQuarantine` **(counsel)**                                                                                                         | DB: insert trigger sets retain-until, guard refuses earlier deletes                              |
| Cleared false positive                                                                   | at most 30 more days                                                                                                                                                                                         | `update_quarantine_item('clear')`                                                                |
| Suspected CSAM                                                                           | under legal hold, no end date, until reported; after the report at least **one year** from the report (18 U.S.C. § 2258A(h), as amended in 2024) **(counsel)**, and the hold stays until counsel releases it | DB: CHECK constraint, `release_hold` refused before `reported`, guard refuses deletes under hold |
| Any item subject to a preservation request (e.g. 18 U.S.C. § 2703(f)) or litigation hold | until released                                                                                                                                                                                               | `place_hold`                                                                                     |
| Access log                                                                               | indefinitely (append-only) **(counsel: set a period)**                                                                                                                                                       | DB: append-only trigger                                                                          |

**Legal hold rules**

- Suspected CSAM is placed under hold automatically and cannot be released or cleared by a single reviewer before it has been reported.
- A hold blocks deletion for every role, including the service role and a database superuser (only dropping the trigger, a reviewed migration, would bypass it).
- Account deletion does **not** remove quarantined items or their records (they are not keyed by user and have no foreign key); it removes the user's other staged files. **(counsel)**: confirm this retention basis for erasure requests (GDPR Art. 17(3)(b)/(e), CCPA exemptions).
- Data export does **not** list files held for a safety review **(counsel)**: confirm the law-enforcement exemption for access requests and the rule against tipping off the uploader.

**Escalation for suspected child sexual abuse material**

1. Automated detection quarantines and preserves the original, records its SHA-256, and alerts every superadmin (`safety_alert` notification and an `ai.content_quarantine` audit entry). The uploader is told only "That picture can't be sent" / "flagged by our automated safety check"; never tell them more. **(counsel)**
2. A US provider that obtains actual knowledge of apparent CSAM must report it to NCMEC's CyberTipline as soon as reasonably possible (18 U.S.C. § 2258A). **(counsel)**: whether an automated classifier hit is "actual knowledge", and whether a human must view the file before reporting (see the Fourth Amendment line of cases on provider review, e.g. _United States v. Wilson_, 9th Cir. 2021). Record the report with `mark_reported` and the CyberTipline report id.
3. Preserve: never delete, edit, re-encode or move the original (the database refuses). Preserve the record, the hash and the access log. Respond to law-enforcement preservation requests with `place_hold`.
4. **Never re-share.** Do not download, forward, screenshot, attach to tickets, email or paste the file or its signed URL anywhere. The only transmission is the CyberTipline report itself. Do not open it outside the review flow.
5. Account action (suspension) per the trust and safety policy; do not notify the account of the report. **(counsel)**
6. Non-US users or jurisdictions (e.g. IWF in the UK, EU rules) **(counsel)**.

**Reviewer exposure**

- View only when needed to decide or report; prefer the classifier categories and hash.
- The reviewer UI (not built yet, see open items) must show the image blurred and greyscale by default, reveal on an explicit click, never cache it, and offer the reporting step in the same screen.
- Each view needs a written reason and is audited; URLs live 60 seconds and are single-use grants.
- Rotate reviewers, limit session length, and offer wellbeing support. **(owner)**

## Account purge and data export (L1)

- `purgeUserAccount` now calls `purgeStagedImagesForUser`: lists `{user}/` in `image-staging` (paginated), removes every file and its moderation row except staged originals marked `quarantined` (from before this change), and stops the purge (before the auth user is deleted, so it can be retried) if the listing or lookup fails. A missing bucket is skipped.
- `requestDataExport` (category `media_metadata`) adds `staged_images`: name, size and upload time of the user's staged files, without held ones. No bytes.

## Runtime (release blocker)

`wrangler.jsonc` deploys the app to **Cloudflare Workers** (`nodejs_compat`). sharp is a native Node module (libvips) and **does not load in Workers**. `sharp` is only installed here as a dependency of `miniflare` (dev tooling), not of the app. The re-encoder loads sharp lazily with a non-literal specifier so the Workers bundle does not try to include it; if it cannot load, every promotion is **held** (fail closed, nothing published, retryable) and every legacy direct upload is refused. **Shipping this branch to the current Workers deployment would therefore stop all image uploads.** Options for the owner:

1. Run promotion in a Node runtime (a small Node service or Lambda/Cloud Run function called by the server function with a service credential), with `sharp` as a real dependency there. Recommended.
2. A WASM build of libvips (`@img/sharp-wasm32`) inside the Worker: check bundle size limits and memory (a 30 MP RGBA frame is 120 MB raw) first.
3. Cloudflare Images (decode/re-encode at the edge): a third-party processor of user images; needs its own privacy review.

`sharp` must then be added to the runtime's `dependencies` (not done here: the lockfile is Lovable-managed). Memory: the raw round trip holds one decoded frame (worst case 30 MP × 4 bytes = 120 MB) plus the encoder's buffers; measure on the target runtime.

## Deploy order

1. Migration `20261108120000_image_quarantine_reencode.sql` (additive; depends on `20261106120000` and the SEC-2 `private_sec.is_superadmin`).
2. Image processing runtime (above), then the app.

An app without the migration: a flagged file's quarantine copy fails (no bucket), so the original stays where it was (fail closed, as before) and is escalated there.

## Tests

- `src/lib/image-reencode.server.test.ts` (50): the four phone JPEG fixtures, ten repo JPEG assets, four repo PNG icons, a PNG with alpha (RGBA identical), lossy and lossless WEBP, all eight orientations across the three formats, a Display P3 photo; payloads in a JPEG ICC profile, in the JPEG tail before EOI (a base64 second image), a whole second WEBP image in a duplicate `VP8 ` chunk, duplicate WEBP `ICCP`, duplicate PNG `pHYs` + extra `IDAT` + a bad-CRC chunk, appended data; bombs (49 MP PNG of a few KB, sharp's own pixel cap, a forged 60000 px JPEG header); GIF, TIFF, AVIF, SVG, BMP, random and empty input; truncated JPEG and corrupt PNG stream; animated WEBP and APNG; sharp unavailable; every decode capped by `limitInputPixels` and fed the stripper's output, never the upload's EXIF/XMP (decoder spy); idempotence (same bytes on retry; second-generation output stable, PNG byte-identical).
- `src/lib/image-promotion.server.test.ts` (34), `src/lib/image-finalize-direct.server.test.ts` (13), `src/lib/image-quarantine.server.test.ts` (15), `src/lib/account-purge.test.ts` (+1).
- `supabase/tests/520_image_quarantine.test.sql` (90): bucket private, no API read/list/write/delete for anon, authenticated, moderators or superadmins, also with broad permissive policies injected and with the trigger disabled (RLS layer alone); Storage's signed-URL writes refused; evidence immutable for the service role; holds and retention enforced for the service role and a superuser; the audited single-use review grant (refusals, expiry, demoted reviewer, append-only audit); reviewer decisions; destruction after retention; requirement 6 on published, quarantined and removed paths (public and private buckets), with the legacy cases that still work.

Fixture finding: `scripts/generate-exif-fixtures.py` stores orientations 6 and 8 rotated the wrong way (`STORED_ROTATION` 6 and 8 are swapped), so a spec-following decoder (libvips here, browsers too) shows `o6.jpg`/`o8.jpg` 180 degrees off `upright-reference.png`. The re-encode tests compare them to the EXIF-correct rendering and cover all eight orientations with generated files; the generator and `e2e/image-orientation.spec.ts` should be checked.

## Must be validated on a VERIFIED Supabase sandbox before release

None of this can be shown locally; no Supabase project was configured or accessed for this work.

1. **Owner stamping on signed-URL writes**: a PUT through a signed upload URL is written as `service_role` with the signer in `owner`/`owner_id` (so `published_image_refuse_user_write`, `image_quarantine_guard` and #268's triggers refuse it), and a service-key upload carries no owner (so the server's writes are trusted). If Storage ever wrote these with no owner or as a superuser, the triggers would let a user's write through.
2. **Trigger creation on `storage.objects`**: that the migration role may create triggers on `storage.objects` in the hosted project, and that Storage's own role (`supabase_storage_admin`) can execute `private_sec.storage_write_is_trusted`, `image_path_processed` and `image_quarantine_deletable` (the migration grants them when the role exists).
3. **`info()` version**: Storage's `info()` returns `id` and `version`, and an upsert keeps the id and changes the version (attachments, unchanged from #268).
4. **Private-bucket signed URLs**: `createSignedUrl` on `image-quarantine` works for the service key with a 60-second lifetime and the URL stops working after expiry; the public URL form (`/object/public/image-quarantine/...`) returns an error; anon and user keys cannot list, download, sign or upload in the bucket; Storage's delete API is refused (and leaves the object in place) while a hold applies; Storage does not update `storage.objects` rows on read in a way the guard refuses.
5. **CDN**: a published object replaced by the server and a flagged legacy object removed by the server stop being served by the CDN (cache headers and purge latency; the legacy direct path uploads with a one-year cache header). Unchanged open item from #268.
6. The five-minute staging SELECT window against Storage's `INSERT ... RETURNING`, and the sweepers (staging and quarantine) against real pagination (from #268).
7. The image-processing runtime ([Runtime](#runtime-release-blocker)): that sharp loads, its memory and time on a 30 MP input, and end-to-end promotion with the scanner.

## Open items

- **Release blocker**: image-processing runtime (above).
- Reviewer screen for quarantined originals (blurred by default) calling `superadminReviewQuarantinedImage`; a dedicated safety-reviewer role.
- Chat attachments are not re-encoded (they are private to the conversation; animated stickers are allowed there by product decision). Recommended next: re-encode still attachments the same way once the runtime exists; animated attachments remain single-frame scanned.
- Staged originals quarantined before this change stay in `image-staging` (held, never swept); a one-off service script can move them to the quarantine.
- Retention sweeps are manual (not scheduled), like the staging sweeper.
- Counsel review of every **(counsel)** item above.
- The EXIF fixture generator bug (above).
- Phase 2 (closing legacy direct uploads) is unchanged and still separately approved.
