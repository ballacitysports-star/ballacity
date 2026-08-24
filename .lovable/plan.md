# Accept bare domains (xxx.com) in every URL field

Users should be able to type `xxx.com` anywhere a website/link is entered, and the app stores and links out to a proper `https://xxx.com`.

## Current state

- `src/components/OrgForm.tsx` — `validateOrgForm` rejects anything not matching `/^https?:\/\//i` with "Website must start with http(s)://"; the input placeholder is `https://example.com`.
- `src/components/profile/ProfileLinksFields.tsx` — `normalizeProfileUrl` already prepends `https://`, but `validateProfileUrl` can still surface "Must start with http:// or https://".
- `src/components/ProfileLinks.tsx` — link placeholders show `https://yoursite.com`.
- `src/lib/org-listing.ts` — `websiteHref` already normalizes bare domains and rejects unsafe/invalid values. This becomes the single source of truth for website normalization.
- `src/lib/payments.ts` — payment link fields show full-URL hints (`https://venmo.com/u/…`).

## Changes

1. **Gym/org editor** (`src/components/OrgForm.tsx`)
   - Validate the website with `websiteHref` instead of the scheme regex; error text becomes "Enter a valid website (e.g. example.com)".
   - Placeholder becomes `example.com`.

2. **Normalize on save** — `src/routes/orgs.create.tsx` and `src/routes/orgs.$orgId.edit.tsx` run `website` through `websiteHref(...)` so the database always stores an absolute `https://` URL even though the user typed a bare domain. Same for the trainer and team editors if they carry a website field.

3. **Profile links** (`src/components/profile/ProfileLinksFields.tsx`)
   - Drop the "Must start with http:// or https://" message; scheme-less input is normalized, and only a genuinely bad scheme (e.g. `javascript:`) errors, with wording "Enter a valid website (e.g. example.com)".
   - Keep the existing domain/TLD checks so typos are still caught.

4. **Placeholders across link inputs** (`src/components/ProfileLinks.tsx`, and payment link hints in `src/lib/payments.ts`)
   - Show bare-domain examples (`yoursite.com`, `venmo.com/u/…`) so the UI stops implying a scheme is required.

5. **Trainer / team / any other website or link inputs**
   - Sweep for remaining URL inputs and apply the same relaxed validation, normalization on save, and bare-domain placeholder.

6. **Tests** (`src/lib/org-listing.test.ts` plus a small test for `normalizeProfileUrl`/`validateProfileUrl`)
   - Bare domain accepted and normalized to `https://…`.
   - `javascript:` and nonsense values still rejected.
   - Paths and subdomains (`sub.example.com/gym`) preserved.

No database or schema changes; validation, normalization, placeholders, and tests only.