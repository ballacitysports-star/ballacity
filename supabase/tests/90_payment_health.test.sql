-- payment_health_metrics: only a superadmin can read it, and it counts what the
-- payment records say: disputes, host cancellations after payment, refunds owed
-- and overdue, and the hosts with more than one problem.
BEGIN;

SELECT t.person('admin', 40), t.person('hosta', 35), t.person('hostb', 33),
       t.person('playerone', 25), t.person('playertwo', 27), t.person('playerthree', 29),
       t.person('playerfour', 31), t.person('playerfive', 24);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('admin'), 'superadmin');

INSERT INTO public.hosted_games (id, host_id, sport, title, date) VALUES
  ('ph-a1', t.id('hosta'), 'basketball', 'A one', now() + interval '5 days'),
  ('ph-a2', t.id('hosta'), 'basketball', 'A two', now() + interval '6 days'),
  ('ph-a3', t.id('hosta'), 'basketball', 'A three', now() + interval '7 days'),
  ('ph-b1', t.id('hostb'), 'basketball', 'B one', now() + interval '5 days');

-- Inside the 90 day window.
INSERT INTO public.payment_submissions
  (game_id, host_id, player_id, payment_type, status, paid_amount, submitted_at)
VALUES
  ('ph-a1', t.id('hosta'), t.id('playerone'), 'venmo', 'verified', 10, now() - interval '10 days'),
  ('ph-a1', t.id('hosta'), t.id('playertwo'), 'paypal', 'verified', 10, now() - interval '10 days'),
  ('ph-b1', t.id('hostb'), t.id('playerfive'), 'venmo', 'pending', 20, now() - interval '2 days');

-- Disputed once, since resolved: it still counts as a dispute.
INSERT INTO public.payment_submissions
  (game_id, host_id, player_id, payment_type, status, paid_amount, submitted_at, disputed_at)
VALUES
  ('ph-b1', t.id('hostb'), t.id('playerfour'), 'venmo', 'verified', 20, now() - interval '3 days', now() - interval '1 day');

-- The host cancelled two games after being paid. One refund has been owed for 5 days.
INSERT INTO public.payment_submissions
  (game_id, host_id, player_id, payment_type, status, paid_amount, submitted_at,
   cancellation_reason, cancelled_at, refund_status, refund_amount, refund_settled_at)
VALUES
  ('ph-a2', t.id('hosta'), t.id('playerone'), 'venmo', 'cancelled', 10, now() - interval '9 days',
   'game_cancelled', now() - interval '5 days', 'owed', 10, now() - interval '5 days'),
  ('ph-a3', t.id('hosta'), t.id('playerthree'), 'venmo', 'cancelled', 10, now() - interval '9 days',
   'game_cancelled', now() - interval '1 hour', 'owed', 10, now() - interval '1 hour');

-- Outside the window: counted at 365 days, not at 90.
INSERT INTO public.payment_submissions
  (game_id, host_id, player_id, payment_type, status, paid_amount, submitted_at)
VALUES
  ('ph-b1', t.id('hostb'), t.id('playertwo'), 'venmo', 'verified', 20, now() - interval '200 days');

-- ---- who can read it --------------------------------------------------------
SELECT t.as_anon();
SELECT t.throws('SELECT public.payment_health_metrics(90)', 'permission denied', 'a visitor cannot call it');
SELECT t.as_user(t.id('hosta'));
SELECT t.throws('SELECT public.payment_health_metrics(90)', 'SUPERADMIN_ONLY', 'a host cannot read it, even for their own games');
SELECT t.as_user(t.id('playerone'));
SELECT t.throws('SELECT public.payment_health_metrics(90)', 'SUPERADMIN_ONLY', 'a player cannot read it');
SELECT t.as_user(t.id('admin'));
SELECT t.lives('SELECT public.payment_health_metrics(90)', 'a superadmin can read it');

-- ---- what it counts (90 days) ----------------------------------------------
SELECT t.eq((public.payment_health_metrics(90)->'submissions'->>'total')::int, 6, 'submissions: counts only the window');
SELECT t.eq((public.payment_health_metrics(90)->'submissions'->>'verified')::int, 3, 'submissions: verified');
SELECT t.eq((public.payment_health_metrics(90)->'submissions'->>'pending')::int, 1, 'submissions: pending');
SELECT t.eq((public.payment_health_metrics(90)->'submissions'->>'cancelled')::int, 2, 'submissions: cancelled');
SELECT t.eq((public.payment_health_metrics(90)->'submissions'->>'disputed')::int, 1, 'disputes: a resolved dispute still counts');
SELECT t.eq((public.payment_health_metrics(90)->'submissions'->>'dispute_rate_pct')::numeric, 16.7::numeric, 'disputes: rate is disputes over submissions');
SELECT t.eq((public.payment_health_metrics(90)->'submissions'->>'verified_dollars')::numeric, 40::numeric, 'submissions: verified dollars');

SELECT t.eq((public.payment_health_metrics(90)->'refunds'->>'owed_now_count')::int, 2, 'refunds: both owed refunds are outstanding');
SELECT t.eq((public.payment_health_metrics(90)->'refunds'->>'owed_now_dollars')::numeric, 20::numeric, 'refunds: outstanding dollars');
SELECT t.eq((public.payment_health_metrics(90)->'refunds'->>'owed_overdue_count')::int, 1, 'refunds: only the one owed over 3 days is overdue');
SELECT t.eq((public.payment_health_metrics(90)->'refunds'->>'owed_overdue_dollars')::numeric, 10::numeric, 'refunds: overdue dollars');

SELECT t.eq((public.payment_health_metrics(90)->'host_cancellations'->>'games_that_took_payment')::int, 4, 'cancellations: games that took a payment');
SELECT t.eq((public.payment_health_metrics(90)->'host_cancellations'->>'games_cancelled_after_payment')::int, 2, 'cancellations: games the host cancelled after payment');
SELECT t.eq((public.payment_health_metrics(90)->'host_cancellations'->>'players_affected')::int, 2, 'cancellations: players affected');
SELECT t.eq((public.payment_health_metrics(90)->'host_cancellations'->>'dollars_affected')::numeric, 20::numeric, 'cancellations: dollars affected');
SELECT t.eq((public.payment_health_metrics(90)->'host_cancellations'->>'rate_pct')::numeric, 50.0::numeric, 'cancellations: rate is cancelled games over games that took payment');

SELECT t.eq(jsonb_array_length(public.payment_health_metrics(90)->'repeat_hosts'), 1, 'hosts: only the host with two or more problems is listed');
SELECT t.eq((public.payment_health_metrics(90)->'repeat_hosts'->0->>'host_id')::uuid, t.id('hosta'), 'hosts: the right host');
SELECT t.eq((public.payment_health_metrics(90)->'repeat_hosts'->0->>'problems')::int, 3, 'hosts: two cancellations plus one overdue refund');

SELECT t.eq((SELECT (e->>'submissions')::int FROM jsonb_array_elements(public.payment_health_metrics(90)->'by_type') e WHERE e->>'payment_type' = 'venmo'), 5, 'by type: venmo');
SELECT t.eq((SELECT (e->>'submissions')::int FROM jsonb_array_elements(public.payment_health_metrics(90)->'by_type') e WHERE e->>'payment_type' = 'paypal'), 1, 'by type: paypal');

-- ---- the window ------------------------------------------------------------
SELECT t.eq((public.payment_health_metrics(365)->'submissions'->>'total')::int, 7, 'window: 365 days includes the old payment');
SELECT t.eq((public.payment_health_metrics(0)->>'days')::int, 1, 'window: clamped to at least a day');
SELECT t.eq((public.payment_health_metrics(100000)->>'days')::int, 730, 'window: clamped to two years');
SELECT t.eq((public.payment_health_metrics(NULL)->>'days')::int, 90, 'window: defaults to 90 days');

SELECT t.reset();
ROLLBACK;
