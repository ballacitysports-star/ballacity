-- Freeze player_profiles: managed children are now real, credential-less auth
-- users (20260930120000_managed_children.sql), so the "Account -> Player
-- Profile" refactor stops at stage 1 and its stage 3 (repointing games,
-- rosters, media and messages at player_profile_id) will not happen.
--
-- Writes are closed because the table was an open door once it had readers:
-- any login — a minor's included — could insert a login-less "child" with any
-- birthday, and date_of_birth stayed editable, which would have turned a
-- child into an adult the moment anything trusted the derived cohort.
--
-- SELECT and DELETE stay: Parent Center lists rows that parents created
-- through the old /players/add screen (user_id IS NULL) as "finish setting
-- up <name>", creates the managed child, then deletes the old row. All four
-- policies are kept as they were.
--
-- Revoking a table-level privilege also revokes the matching column-level
-- privileges (stage 1 granted INSERT and UPDATE per column).

REVOKE INSERT, UPDATE ON public.player_profiles FROM authenticated;

COMMENT ON TABLE public.player_profiles IS
  'Frozen (read/delete only). Superseded by managed_accounts: managed children are credential-less auth users so every child-safety control applies. Remaining rows with user_id IS NULL are leftovers from the old Add Player screen.';
