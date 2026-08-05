# Teams are the only profile you can create, and the only way to host

Any account can host a game — but hosting always happens under a team profile. Creating trainer and gym profiles goes away; team is the only profile type you can add.

## What changes

- Host a game is gated on owning a team profile. Player-only accounts see one path: "Create a team".
- Gym profiles no longer appear in "Host as" and can't publish games; the picker lists only teams you own and preselects your active team when you're acting as one.
- All hosting copy (empty state, toasts, helper text, publish button) says "team profile" instead of "team or gym".
- Signup / onboarding profile picker offers only Player and Team.
- The profile switcher's "Add a profile" list offers only "New team".
- `/trainers/create` and `/orgs/create` redirect to `/teams/create`, so old links and bookmarks land somewhere useful instead of a removed flow.

## What is kept

Trainer and gym profiles that already exist stay in the switcher, stay viewable and editable, and keep their own pages — they just can't be created anymore and can't host games. No data is deleted.

## Technical section

- `src/lib/account-type.ts`: add a `CREATABLE_ACCOUNT_TYPES = ["player", "team"]` list; keep the full `AccountType` union and `ACCOUNT_TYPE_META` so existing trainer/gym profiles still render with correct labels.
- `src/components/AccountTypePicker.tsx`: iterate the creatable list; update the subtitle wording ("you can add team profiles later").
- `src/components/ProfileSwitcher.tsx`: `ADDABLE` becomes `["team"]`.
- `src/routes/_tabs.create.tsx`: drop `myOrgs` / `listMyOrgs` from the affiliation list so only owned teams (still excluding `kind === "coach"`) qualify; simplify `Affiliation` to teams; remove the "Create a club / gym" link from the empty state; update the gate heading, body copy, toast, hint, and submit-button strings.
- `src/routes/trainers.create.tsx` and `src/routes/orgs.create.tsx`: replace the component with a `beforeLoad` redirect to `/teams/create`.
- No database changes: `hosted_games.team_id` / `org_id` already exist and existing gym-hosted games keep working.
