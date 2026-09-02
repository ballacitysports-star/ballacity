CREATE POLICY "Guardian reads child consent history"
ON public.parental_consent_events
FOR SELECT TO authenticated
USING (public.is_guardian_of(auth.uid(), child_user_id));

CREATE POLICY "Guardian reads child age change history"
ON public.age_change_events
FOR SELECT TO authenticated
USING (public.is_guardian_of(auth.uid(), user_id));