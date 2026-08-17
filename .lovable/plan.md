# Fix gym image uploads ("new row violates row-level security policy")

## What's wrong

Gym image uploads (logo, cover, gallery) are stored in folders named after the **signed-in user's id**, but the storage access rule for gym buckets only allows folders named after the **gym's id**. Every upload from the gym edit page is therefore rejected.

Confirmed:
- `src/components/OrgForm.tsx` passes `pathPrefix={userId}` for logo, cover, and gallery uploads.
- The storage rule "Org admins write org images" allows writes only when the first folder segment is a gym id the user administers.

## The fix

1. Gym edit page (`/orgs/:orgId/edit`): upload into the gym's own folder — pass the gym id as the upload folder instead of the user id. This satisfies the existing admin rule.
2. Gym create page (`/orgs/create`): no gym exists yet, so keep using the user's own folder. Add a storage rule so authenticated users may write gym images into a folder named after their own user id (their own staging area only), alongside the existing gym-admin rule. Public read stays unchanged.
3. Leave already-uploaded image URLs untouched — existing files remain readable.

## Technical notes

- `OrgForm` gains an explicit upload-folder prop (`uploadPrefix`) that the edit route sets to `orgId` and the create route sets to `userId`; `ImageUploader` and `PhotoGalleryEditor` keep their current API.
- Migration adds INSERT/UPDATE/DELETE policies on `storage.objects` for buckets `org-avatars` and `org-covers` scoped to `(storage.foldername(name))[1] = auth.uid()::text` for role `authenticated`. Existing `is_trainer_org_admin` policy is kept as-is.

## Verification

- Load the gym edit page, upload a logo, cover, and one gallery photo; confirm no RLS error and the images render after save.
- Repeat on the gym create page before the gym exists.
