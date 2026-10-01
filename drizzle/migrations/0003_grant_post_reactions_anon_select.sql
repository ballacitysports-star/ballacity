-- Restore the anon SELECT grant on post_reactions so the same policy that
-- already scopes visibility (private_sec.can_comment_on_minor_content) is
-- reachable by the publishable client used for logged-out reaction lists.
-- post_comments already carries this grant; post_reactions was missed.
GRANT SELECT ON public.post_reactions TO anon;
