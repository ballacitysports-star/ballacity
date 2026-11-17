import { supabase } from "@/integrations/supabase/client";

/**
 * The signed-in user's id, read from the session this browser already holds.
 *
 * `supabase.auth.getUser()` asks the auth server who the token belongs to on every call. Client
 * code that only needs the id to filter its own rows or stamp its own inserts paid that round
 * trip (1-8 s on a loaded auth server) before every read and write on the game and pay pages.
 * `getSession()` reads the stored session instead; it goes to the network only when the access
 * token is about to expire, to refresh it, and then answers with the refreshed session (or none,
 * when the refresh is refused).
 *
 * This is safe only where the server checks the id again, and every caller relies on that: the
 * request still carries the access token, and Row Level Security compares rows and inserts with
 * `auth.uid()` from that verified token. A stale or tampered local id can therefore make a query
 * come back empty or an insert be refused, never return or write another user's rows. Use it in
 * client code only; server functions must keep verifying the token with `getUser()`.
 *
 * Signing in, out or switching accounts updates the stored session, so the next call sees it.
 * Returns null when there is no usable session.
 */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}
