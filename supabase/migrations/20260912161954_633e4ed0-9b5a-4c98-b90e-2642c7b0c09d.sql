DROP POLICY IF EXISTS "Follows are readable by anyone" ON public.follows;
CREATE POLICY "Follows are readable by signed-in users"
ON public.follows FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Reactions are readable by everyone" ON public.post_reactions;
CREATE POLICY "Reactions are readable by signed-in users"
ON public.post_reactions FOR SELECT TO authenticated USING (true);

REVOKE SELECT ON public.follows FROM anon;
REVOKE SELECT ON public.post_reactions FROM anon;