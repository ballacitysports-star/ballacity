-- 1. Table
CREATE TABLE public.legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL CHECK (document_type IN (
    'terms','privacy','community_guidelines','safety_guidelines',
    'payment_policy','ai_disclosure','youth_policy','cookie_preferences'
  )),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  version text NOT NULL CHECK (length(btrim(version)) BETWEEN 1 AND 64),
  content text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  requires_reacceptance boolean NOT NULL DEFAULT false,
  effective_date date NOT NULL DEFAULT current_date,
  published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  archived_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_type, version)
);

-- Only one active (published) version per document type.
CREATE UNIQUE INDEX legal_documents_one_published_per_type
  ON public.legal_documents(document_type) WHERE published;

CREATE INDEX legal_documents_type_idx ON public.legal_documents(document_type, effective_date DESC);

-- 2. Grants
GRANT SELECT ON public.legal_documents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_documents TO authenticated;
GRANT ALL ON public.legal_documents TO service_role;

-- 3. RLS
ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;

-- 4. Policies
CREATE POLICY "Anyone can read live published documents"
ON public.legal_documents FOR SELECT TO anon, authenticated
USING (published AND effective_date <= current_date);

CREATE POLICY "Admins can read every version"
ON public.legal_documents FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY "Admins can create drafts"
ON public.legal_documents FOR INSERT TO authenticated
WITH CHECK (
  (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'))
  AND created_by = auth.uid()
  AND published = false
);

CREATE POLICY "Admins can edit drafts"
ON public.legal_documents FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY "Admins can delete unpublished drafts"
ON public.legal_documents FOR DELETE TO authenticated
USING (
  (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'))
  AND published_at IS NULL
);

-- 5. Immutability of published history: content/version/effective date frozen once published.
CREATE OR REPLACE FUNCTION public.legal_documents_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    IF NEW.content <> OLD.content
       OR NEW.version <> OLD.version
       OR NEW.title <> OLD.title
       OR NEW.summary <> OLD.summary
       OR NEW.effective_date <> OLD.effective_date
       OR NEW.document_type <> OLD.document_type
       OR NEW.requires_reacceptance <> OLD.requires_reacceptance THEN
      RAISE EXCEPTION 'Published legal document versions are immutable; create a new version instead';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER legal_documents_guard_trg
BEFORE UPDATE ON public.legal_documents
FOR EACH ROW EXECUTE FUNCTION public.legal_documents_guard();

-- 6. Publish / unpublish helpers (admin only, audited)
CREATE OR REPLACE FUNCTION public.publish_legal_document(_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _doc public.legal_documents;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin')) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  SELECT * INTO _doc FROM public.legal_documents WHERE id = _id;
  IF _doc.id IS NULL THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF _doc.published THEN RETURN _doc.id; END IF;
  IF length(btrim(_doc.content)) = 0 THEN RAISE EXCEPTION 'Cannot publish an empty document'; END IF;

  UPDATE public.legal_documents
     SET published = false, archived_at = now()
   WHERE document_type = _doc.document_type AND published AND id <> _id;

  UPDATE public.legal_documents
     SET published = true,
         archived_at = NULL,
         published_at = COALESCE(published_at, now())
   WHERE id = _id;

  INSERT INTO public.admin_audit_log(actor_id, action, target_type, target_id, reason, after)
  VALUES (auth.uid(), 'legal_document_published', 'legal_document', _id::text, _doc.summary,
          jsonb_build_object('document_type', _doc.document_type, 'version', _doc.version,
                             'effective_date', _doc.effective_date,
                             'requires_reacceptance', _doc.requires_reacceptance));
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unpublish_legal_document(_id uuid, _reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin')) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  UPDATE public.legal_documents
     SET published = false, archived_at = now()
   WHERE id = _id AND published;

  INSERT INTO public.admin_audit_log(actor_id, action, target_type, target_id, reason)
  VALUES (auth.uid(), 'legal_document_unpublished', 'legal_document', _id::text, _reason);
  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_legal_document(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unpublish_legal_document(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_legal_document(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpublish_legal_document(uuid, text) TO authenticated;

-- 7. Users needing re-acceptance of a published document version (admin only)
CREATE OR REPLACE FUNCTION public.legal_reacceptance_pending(_document_type text, _version text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n bigint;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin')) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  SELECT count(*) INTO _n
  FROM public.profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.legal_consents lc
    WHERE lc.user_id = p.id
      AND lc.document_type = _document_type
      AND lc.document_version = _version
  );
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.legal_reacceptance_pending(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legal_reacceptance_pending(text, text) TO authenticated;

-- 8. Consent records may reference every document type
ALTER TABLE public.legal_consents DROP CONSTRAINT IF EXISTS legal_consents_document_type_check;
ALTER TABLE public.legal_consents ADD CONSTRAINT legal_consents_document_type_check
  CHECK (document_type IN (
    'terms','privacy','community_guidelines','safety_guidelines',
    'payment_policy','ai_disclosure','youth_policy','cookie_preferences'
  ));

-- 9. Seed: current published Terms + Privacy, drafts for the rest
INSERT INTO public.legal_documents (document_type, title, version, summary, requires_reacceptance, effective_date, published, published_at, content)
VALUES
('terms','Terms of Service','2026-09-01','First published placeholder terms covering accounts, games, payments, and conduct.',true,'2026-09-01',true,now(),
'## 1. Your account
You need an OpenRun account to join or host games. Keep your sign-in details secure and provide accurate information about yourself.

You must meet the minimum age set for any game you join, and hosts may require approval before you participate.

## 2. Games and participation
OpenRun connects players, teams, trainers, and gyms. We do not organize, supervise, coach, or insure any activity listed on the platform.

You take part in physical activity at your own risk and are responsible for your own health, equipment, and safety decisions.

## 3. Payments between players and hosts
OpenRun does not process payments, hold funds, or act as an escrow or payment processor. Any entry fee is paid directly between you and the host.

Verify recipient details before sending money. Refunds and disputes are handled between you and the host.

## 4. Content and conduct
You are responsible for the profiles, posts, highlight reels, and messages you publish, and you must have the rights to any media you upload.

Harassment, discrimination, impersonation, illegal activity, and sexually explicit or violent content are not allowed. We may hide or remove content and suspend accounts that break these rules.

## 5. Changes and ending your account
We may update these terms. When a change is material we will ask you to accept the new version before continuing to use the app.

You can delete your account at any time from Settings. Some records may be retained where we are required to keep them.'),
('privacy','Privacy Policy','2026-09-01','First published placeholder privacy policy covering profile data, location, media, and your controls.',true,'2026-09-01',true,now(),
'## 1. What we collect
Account details you give us: name, email, sign-in provider, profile photo, bio, sports, skill levels, availability, and links.

Activity data: games you host or join, requests, messages, comments, reactions, reviews, and highlight reels you upload.

Device and approximate location data used to show distances and nearby games, only while you allow location access.

## 2. Why we use it
To run the core product: matching players with games, showing distance, sending notifications you enabled, and keeping the platform safe.

To troubleshoot problems and to detect abuse, spam, and policy violations.

## 3. Sharing
Parts of your profile are public by design (name, initials, sports, and public reels). Your photo visibility follows the setting you pick in Settings.

We use service providers for hosting, storage, media processing, and notifications. We do not sell your personal data.

## 4. Your controls
You can edit or hide profile details, control photo visibility, manage notification preferences, hide or delete highlight reels, block users, and delete your account.

Your legal consent history is visible to you under Settings, Legal and Privacy.

## 5. Retention and contact
We keep data while your account is active and for as long as needed to meet legal or safety obligations.

For privacy questions, contact the OpenRun team through the app.'),
('community_guidelines','Community Guidelines','draft-1','Initial draft placeholder pending legal review.',false,current_date,false,NULL,
'## Placeholder
LEGAL REVIEW REQUIRED. Draft community guidelines describing expected behaviour, unacceptable behaviour, and enforcement.'),
('safety_guidelines','Safety Guidelines','draft-1','Initial draft placeholder pending legal review.',false,current_date,false,NULL,
'## Placeholder
LEGAL REVIEW REQUIRED. Draft safety guidance for meeting players, game safety, payments, and messaging.'),
('payment_policy','Payment Policy','draft-1','Initial draft placeholder pending legal review.',false,current_date,false,NULL,
'## Placeholder
LEGAL REVIEW REQUIRED. Draft policy explaining that OpenRun does not process payments and that entry fees are paid directly between players and hosts.'),
('ai_disclosure','AI / Video Disclosure','draft-1','Initial draft placeholder pending legal review.',false,current_date,false,NULL,
'## Placeholder
LEGAL REVIEW REQUIRED. Draft disclosure describing how uploaded video is analysed, what is generated, its limitations, and how to opt out.'),
('youth_policy','Youth / Minor Policy','draft-1','Initial draft placeholder pending legal review.',false,current_date,false,NULL,
'## Placeholder
LEGAL REVIEW REQUIRED. Draft policy covering the minimum age, teen account protections, and messaging restrictions.'),
('cookie_preferences','Cookie & Privacy Preferences','draft-1','Initial draft placeholder pending legal review.',false,current_date,false,NULL,
'## Placeholder
LEGAL REVIEW REQUIRED. Draft explanation of storage used for sign-in and preferences, and how to manage privacy settings.');