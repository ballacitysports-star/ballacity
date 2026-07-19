## Notify interested players when trainer availability changes

When a trainer updates their weekly slots, recurring rules, or date overrides, push an in-app notification to players who have a stake in that schedule.

### Who gets notified
For a trainer `T`, the interested set is the union of:
1. **Past/current bookers** — distinct `from_user_id` from `trainer_session_requests` where `trainer_id = T` and `status IN ('pending','accepted','completed')`.
2. **Followers** — `follower_id` from `follows` where `followee_id = T.owner_id` (trainers whose owner has followers). Followers are opt-in via existing "Follows" notification preference; bookers always get it (transactional).

De-duplicate, exclude the trainer themself, and honor `user_blocks` and `notification_preferences` (new `trainer_availability` category, default on).

### Change detection
Add a Postgres trigger on `public.teams` (AFTER UPDATE) that fires only when `kind = 'coach'` and any of these change:
- `availability_slots`, `availability_rules`, `availability_overrides`, `primary_venue`, `venue_addresses`, `timezone`.

The trigger computes a short human summary (e.g. "added Tue 6–8pm", "removed 2 windows", "updated recurring rule", "closed Mar 12") by diffing OLD vs NEW jsonb arrays with element-count and key-presence heuristics — no per-slot diff to keep it cheap. Falls back to "Availability updated" when the diff is ambiguous.

### Notification payload
Insert one row per recipient into `public.notifications`:
- `type = 'trainer_availability'`
- `title = "<Trainer name> updated their availability"`
- `body  = <summary>` (e.g. "Added Tue 6–8pm in San Jose")
- `link  = "/trainers/<team_id>"`

### Throttling
Avoid notification storms when a trainer edits repeatedly (wizard save button, batch edits). The trigger checks: if the last `trainer_availability` notification for the same trainer→recipient pair is < 30 minutes old, skip the insert (a single per-pair debounce, enforced in SQL).

### Files & changes
1. **Migration**
   - Add `trainer_availability` to allowed values of `notification_preferences.category` (validation trigger already checks a list — extend it) and default = enabled.
   - Create SECURITY DEFINER function `notify_trainer_availability_change()` and AFTER UPDATE trigger on `public.teams`.
   - Include GRANTs / permissions review only for the function (`SECURITY DEFINER`, `SET search_path = public`).

2. **Frontend**
   - `src/routes/_tabs.settings.notifications.tsx` (or equivalent preferences page): add "Trainer availability updates" toggle to the Follows section — or a new "Trainers" section. Wire to `notification_preferences` via existing hook.
   - `src/components/NotificationsPanel.tsx` (or the row renderer): add an icon/label mapping for `type === 'trainer_availability'` so it renders with a calendar icon and routes to the trainer page.

3. **No server function needed** — everything runs from the DB trigger on `teams` updates already made by `updateOrg` in `src/lib/org-store.ts`.

### Explicit non-goals
- No email/push fan-out (existing `notifications` table + in-app inbox is the surface).
- No per-slot precision in the summary (kept intentionally coarse).
- Does not fire on new trainer creation, only updates.
