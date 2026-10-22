/**
 * Shape of `public.payment_health_metrics()`: how often paid games go wrong.
 * It informs whether protected payments (holding a fee until the event) are
 * worth building; the database function is the source of the numbers.
 */
export type PaymentHealth = {
  days: number;
  since: string;
  submissions: {
    total: number;
    verified: number;
    pending: number;
    rejected: number;
    cancelled: number;
    disputed: number;
    dispute_rate_pct: number | null;
    verified_dollars: number;
  };
  by_type: { payment_type: string; submissions: number; verified: number; disputed: number }[];
  refunds: {
    owed_now_count: number;
    owed_now_dollars: number;
    owed_overdue_count: number;
    owed_overdue_dollars: number;
    sent_in_window: number;
    kept_in_window: number;
  };
  host_cancellations: {
    games_that_took_payment: number;
    games_cancelled_after_payment: number;
    players_affected: number;
    dollars_affected: number;
    rate_pct: number | null;
  };
  repeat_hosts: {
    host_id: string;
    display_name: string | null;
    cancelled_games: number;
    disputes: number;
    overdue_refunds: number;
    problems: number;
  }[];
};

export const PAYMENT_HEALTH_WINDOWS = [30, 90, 365] as const;

export function formatPct(value: number | null | undefined): string {
  return value == null ? "—" : `${value}%`;
}

export function formatDollars(value: number | null | undefined): string {
  return `$${Number(value ?? 0).toFixed(2)}`;
}
