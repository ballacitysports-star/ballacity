## Root cause

In `applyOrgChoiceChange` (src/routes/teams.$teamId.edit.tsx around line 380), the `"new"` branch only runs when there is **no** current membership:

```ts
} else if (nextMode === "new" && orgChoice.name && !currentId) {
  await createOrg(...)
}
```

If the trainer is already linked to any org (`initialOrgId` set), picking a new gym silently does nothing — no create, no leave, no toast. There is also no query invalidation after a successful create, so even a fresh trainer's UI doesn't reflect the new gym without a manual reload. A short slug from `slugifyHandle` (< 3 chars) additionally fails the `handle` Zod regex and is swallowed by the catch-all toast.

## Fix

1. In `applyOrgChoiceChange`:
   - When `nextMode === "new"` and `currentId` exists, `leaveOrg` first (best-effort), then `createOrg`.
   - Guarantee `orgHandle` is ≥ 3 chars by padding the fallback (`org${…}` already is, but `slugifyHandle("AB")` → "ab" fails — pad with the timestamp suffix if slug < 3).
   - After a successful create/join/leave, invalidate the `["trainer-org-membership", org.id]` query and update `initialOrgId` locally so the UI reflects the new gym.
2. Surface real errors: replace the silent `catch { /* ignore */ }` around `leaveOrg` with a debug log, and let the outer `catch` continue to toast create/join errors (already does).

## Technical details

- File: `src/routes/teams.$teamId.edit.tsx`
- Function: `applyOrgChoiceChange` (~lines 380–409)
- Also call `queryClient.invalidateQueries({ queryKey: ["trainer-org-membership", org.id] })` after the branch and `setInitialOrgId(newId ?? null)`.
- No schema or server changes needed; `create_trainer_org_with_owner` RPC already inserts the owner membership.

## Out of scope

- No changes to the org creation RPC, RLS, or the OrgForm UI.
