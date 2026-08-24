-- 1) Private game-covers bucket had no read policy at all: signing/reading failed.
CREATE POLICY "Authenticated read game covers"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'game-covers');

-- 2) Image moderation review log
CREATE TABLE public.image_moderation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL,
  path text NOT NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','kept','removed')),
  reason text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, path)
);

GRANT SELECT ON public.image_moderation TO authenticated;
GRANT ALL ON public.image_moderation TO service_role;

ALTER TABLE public.image_moderation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Superadmins read image moderation"
  ON public.image_moderation FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()));

CREATE TRIGGER image_moderation_touch
  BEFORE UPDATE ON public.image_moderation
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX image_moderation_status_idx ON public.image_moderation (status, created_at DESC);
