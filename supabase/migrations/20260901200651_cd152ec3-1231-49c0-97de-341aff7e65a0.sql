-- 1. Anonymous visitors must never hold write privileges on application tables.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon;

-- Pre-auth diagnostics are the only anonymous writes the app performs; their
-- policies already restrict the row to a null or self user_id.
GRANT INSERT ON public.auth_signin_events TO anon;
GRANT INSERT ON public.location_denial_events TO anon;

-- 2. Remove anonymous read privileges on tables that have no anon/public SELECT
--    policy. RLS already returned zero rows for these, so behaviour is unchanged.
REVOKE SELECT ON
  public.account_profiles,
  public.admin_audit_log,
  public.auth_signin_events,
  public.availability_contact_requests,
  public.conversation_participants,
  public.conversations,
  public.feed_preferences,
  public.game_participants,
  public.game_payment_settings,
  public.game_position_waitlist,
  public.game_reminders,
  public.host_payment_methods,
  public.image_moderation,
  public.join_requests,
  public.legal_consents,
  public.location_denial_events,
  public.message_reactions,
  public.messages,
  public.notification_delivery_log,
  public.notification_preferences,
  public.notifications,
  public.org_member_requests,
  public.org_members,
  public.payment_submissions,
  public.payment_verification_events,
  public.player_availabilities,
  public.privacy_preferences,
  public.purchases,
  public.review_helpfuls,
  public.subscriptions,
  public.trainer_org_invites,
  public.trainer_org_join_requests,
  public.trainer_org_members,
  public.trainer_session_requests,
  public.user_blocks,
  public.user_reports,
  public.user_roles
FROM anon;