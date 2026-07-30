-- Idempotent cleanup of legacy per-user skill ratings
ALTER TABLE public.profiles DROP COLUMN IF EXISTS skill_levels;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS skill_level;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS skill;

-- Strip any legacy skill objects that may have been stashed in profiles.links
UPDATE public.profiles
SET links = COALESCE((
  SELECT jsonb_agg(elem)
  FROM jsonb_array_elements(links) AS elem
  WHERE NOT (elem::text ILIKE '%skill%')
), '[]'::jsonb)
WHERE jsonb_typeof(links) = 'array'
  AND links::text ILIKE '%skill%';