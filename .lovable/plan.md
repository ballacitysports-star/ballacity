## Problem

Uploading avatar/cover during trainer create and edit fails with `403 new row violates row-level security policy` on `POST /storage/v1/object/trainer-avatars/{userId}/...`.

Root cause: the storage RLS policies (migration `20260719202354_...sql`) require the **first path segment to equal the team/org id** (looked up via `teams.owner_id = auth.uid()` or `is_trainer_org_admin`), but every uploader in the app uploads under `{auth.uid()}/...`:

- `CreateTrainerWizard.tsx`, `CreateOrgWizard.tsx`, `_tabs.create.tsx`, `profile.edit.tsx`, `teams.$teamId.edit.tsx` all pass `pathPrefix={user?.id}`.
- During create the entity id doesn't exist yet, so user-scoped paths are the only workable choice.

Only the `avatars` / `covers` policy allows `auth.uid()::text = folder[1]`, so those work. Everything else 403s, leaving the image blank in the wizard.

## Fix

Add an RLS migration that lets any authenticated user write to `trainer-avatars`, `team-avatars`, `team-covers`, `org-avatars`, `org-covers` when the first path segment is their own `auth.uid()`, in addition to the existing owner/admin-scoped rule. Public read stays unchanged.

```sql
-- New policy (kept alongside the existing owner/admin one)
CREATE POLICY "Users write own scoped images"
  ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id IN ('trainer-avatars','team-avatars','team-covers','org-avatars','org-covers')
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id IN ('trainer-avatars','team-avatars','team-covers','org-avatars','org-covers')
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
```

No client code changes required — existing `pathPrefix={user?.id}` will now satisfy RLS in both create and edit flows.

## Verification

After migration:
1. Create trainer wizard → upload avatar + cover → expect 200 on the storage POST and preview image renders.
2. Edit existing trainer (`/trainers/c-nc-4kgo/edit`) → change avatar + cover → save → profile shows new images.
3. Team wizard/edit and profile.edit avatar/cover upload continue to work.