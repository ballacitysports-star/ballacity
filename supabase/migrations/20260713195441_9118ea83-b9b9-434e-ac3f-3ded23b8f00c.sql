ALTER TABLE public.payment_submissions
  ADD COLUMN IF NOT EXISTS paid_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

ALTER TABLE public.payment_submissions
  DROP CONSTRAINT IF EXISTS payment_submissions_paid_amount_check;
ALTER TABLE public.payment_submissions
  ADD CONSTRAINT payment_submissions_paid_amount_check
  CHECK (paid_amount IS NULL OR (paid_amount > 0 AND paid_amount <= 100000));

ALTER TABLE public.payment_submissions
  DROP CONSTRAINT IF EXISTS payment_submissions_transaction_reference_len_check;
ALTER TABLE public.payment_submissions
  ADD CONSTRAINT payment_submissions_transaction_reference_len_check
  CHECK (transaction_reference IS NULL OR char_length(transaction_reference) <= 120);