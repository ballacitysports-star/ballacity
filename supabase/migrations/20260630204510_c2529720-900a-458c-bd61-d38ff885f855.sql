
CREATE TABLE public.notification_delivery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('push','inapp','email')),
  status  text NOT NULL CHECK (status IN ('sent','failed','skipped')),
  provider text,
  error text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notification_delivery_log TO authenticated;
GRANT ALL    ON public.notification_delivery_log TO service_role;

ALTER TABLE public.notification_delivery_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own delivery log"
ON public.notification_delivery_log
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX notification_delivery_log_user_created_idx
  ON public.notification_delivery_log (user_id, created_at DESC);
CREATE INDEX notification_delivery_log_notif_idx
  ON public.notification_delivery_log (notification_id);
