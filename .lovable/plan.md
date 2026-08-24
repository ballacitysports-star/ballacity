# Relax gym website field to accept bare domains

## Current state

The gym/org editor (`src/components/OrgForm.tsx`) requires users to type a full URL with a scheme:

- `validateOrgForm` rejects anything that doesn't match `/^https?:\/\//i` with the message "Website must start with http(s)://".
- The Website input placeholder is `https://example.com`.

The link-rendering helper `websiteHref` in `src/lib/org-listing.ts` already normalizes bare domains to `https://` and rejects invalid URLs, so the strict validation is unnecessary and conflicts with the user's expectation of typing `xxx.com`.

## Changes

1. **Relax validation in `src/components/OrgForm.tsx`**
   - Import `websiteHref` from `@/lib/org-listing.ts`.
   - Replace the scheme-mandatory check with a check that uses `websiteHref`: if the user enters a value, it must normalize to a non-null absolute URL; otherwise return a generic "Enter a valid website" error.

2. **Update the Website input placeholder**
   - Change `https://example.com` to `example.com`.

3. **Normalize on save**
   - In `src/routes/orgs.create.tsx` and `src/routes/orgs.$orgId.edit.tsx`, pass `website` through `websiteHref(...)` before saving so the database stores an absolute, safe URL while the user can type a bare domain.

4. **Add a unit test in `src/lib/org-listing.test.ts`**
   - Confirm `websiteHref("example.com")` returns `"https://example.com/"` and `websiteHref("not a url")` returns `null` (the latter already exists in spirit; verify coverage).

No database or schema changes; only frontend validation, normalization, and placeholder updates.