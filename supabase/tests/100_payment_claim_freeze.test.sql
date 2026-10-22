-- A player cannot rewrite the evidence of their payment claim once it leaves pending review.
BEGIN;

SELECT t.person('host', 35), t.person('payer', 30);
INSERT INTO public.hosted_games (id, host_id, sport, title, date)
VALUES ('pay-g1', t.id('host'), 'basketball', 'Paid run', now() + interval '2 days');

-- A claim as the player makes it: pending, with its evidence.
SELECT t.as_user(t.id('payer'));
SELECT t.lives(
  format('INSERT INTO public.payment_submissions (id, player_id, game_id, host_id, payment_type, screenshot_path, transaction_reference, notes) VALUES (%L, %L, ''pay-g1'', %L, ''venmo'', ''proof-a.png'', ''txn-a'', ''first note'')',
    t.id('claim'), t.id('payer'), t.id('host')),
  'a player can submit a claim');
SELECT t.lives(
  format('UPDATE public.payment_submissions SET screenshot_path = ''proof-retake.png'' WHERE id = %L', t.id('claim')),
  'while the claim is pending the player can still fix their proof');

SELECT t.throws(
  format('UPDATE public.payment_submissions SET status = ''disputed'', dispute_reason = ''I paid'', screenshot_path = ''fake.png'' WHERE id = %L', t.id('claim')),
  'locked once a submission leaves pending', 'a player cannot swap their proof in the same update that files a dispute');
SELECT t.throws(
  format('UPDATE public.payment_submissions SET status = ''cancelled'', transaction_reference = ''fake'' WHERE id = %L', t.id('claim')),
  'locked once a submission leaves pending', 'nor change the transaction reference while cancelling');
SELECT t.lives(
  format('UPDATE public.payment_submissions SET status = ''disputed'', dispute_reason = ''I paid'' WHERE id = %L', t.id('claim')),
  'a clean dispute is allowed');

SELECT t.throws(
  format('UPDATE public.payment_submissions SET transaction_reference = ''fake'' WHERE id = %L', t.id('claim')),
  'locked once a submission leaves pending', 'once disputed, the player cannot rewrite the reference');
SELECT t.throws(
  format('UPDATE public.payment_submissions SET payment_type = ''zelle'' WHERE id = %L', t.id('claim')),
  'locked once a submission leaves pending', 'nor the payment type');
SELECT t.lives(
  format('UPDATE public.payment_submissions SET notes = ''more context'' WHERE id = %L', t.id('claim')),
  'but the player can still add a note');
SELECT t.reset();

-- The host reviews as before.
SELECT t.as_user(t.id('host'));
SELECT t.lives(
  format('UPDATE public.payment_submissions SET status = ''verified'', reviewer_notes = ''ok'' WHERE id = %L', t.id('claim')),
  'the host can still review a disputed claim');
SELECT t.reset();

ROLLBACK;
