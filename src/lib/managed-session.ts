import { supabase } from "@/integrations/supabase/client";
import { resetPerUserClientState } from "@/lib/per-user-state";

/**
 * Switching between a guardian and the managed child they act as.
 *
 * The app keeps one Supabase session at a time, and every request carries it
 * (the server-function auth attacher reads the singleton client), so "acting
 * as" the child means the browser genuinely holds the child's session. Every
 * child-safety rule then applies to what the guardian does as the child,
 * because the server sees the child.
 *
 * The guardian's own session is parked in localStorage while they act as the
 * child and restored with one tap. That is a convenience, not a lock: anyone
 * holding the device can switch back, exactly as they could use the
 * guardian's account before the switch.
 *
 * The parked key deliberately does not match `sb-*-auth-token`: other code
 * (authgate-log, the e2e cleanup) finds the live session by that pattern.
 */
export const PARKED_GUARDIAN_KEY = "openrun:guardian-session";

/**
 * True while this tab is itself swapping identities. The swap changes the
 * signed-in user, which is exactly what useManagedSessionWatcher reloads other
 * tabs for; in this tab the swap ends with its own navigation, and a reload
 * racing it would land on the wrong page before the swap finished.
 */
let identitySwitchInProgress = false;

export function isIdentitySwitchInProgress(): boolean {
  return identitySwitchInProgress;
}

export type ParkedGuardianSession = {
  accessToken: string;
  refreshToken: string;
  guardianUserId: string;
  guardianName: string | null;
  childUserId: string;
  childName: string;
  parkedAt: string;
};

export function readParkedGuardianSession(): ParkedGuardianSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PARKED_GUARDIAN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ParkedGuardianSession>;
    if (!v.refreshToken || !v.accessToken || !v.guardianUserId || !v.childUserId) return null;
    return v as ParkedGuardianSession;
  } catch {
    return null;
  }
}

function writeParked(v: ParkedGuardianSession) {
  window.localStorage.setItem(PARKED_GUARDIAN_KEY, JSON.stringify(v));
}

function clearParked() {
  try {
    window.localStorage.removeItem(PARKED_GUARDIAN_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Become the managed child. `tokenHash` comes from `startManagedSession`,
 * which has already checked that the caller is the child's managing guardian.
 * Ends with a full page load so no cached query, store or signed URL from the
 * guardian's session survives into the child's.
 */
export async function switchToManagedChild(input: {
  tokenHash: string;
  childUserId: string;
  childName: string;
  guardianName: string | null;
}): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const current = data.session;
  if (!current) throw new Error("Sign in again to switch profiles.");

  identitySwitchInProgress = true;
  // Stop the timer before snapshotting: a refresh between the snapshot and
  // the swap would rotate the guardian's refresh token and leave a used one
  // parked.
  await supabase.auth.stopAutoRefresh();
  writeParked({
    accessToken: current.access_token,
    refreshToken: current.refresh_token,
    guardianUserId: current.user.id,
    guardianName: input.guardianName,
    childUserId: input.childUserId,
    childName: input.childName,
    parkedAt: new Date().toISOString(),
  });

  const { error } = await supabase.auth.verifyOtp({ token_hash: input.tokenHash, type: "email" });
  if (error) {
    // Nothing changed server-side for the guardian; put their session back.
    clearParked();
    await supabase.auth
      .setSession({ access_token: current.access_token, refresh_token: current.refresh_token })
      .catch(() => undefined);
    await supabase.auth.startAutoRefresh();
    identitySwitchInProgress = false;
    throw new Error("Couldn't switch to that profile. Try again.");
  }

  await resetPerUserClientState();
  window.location.assign("/profile");
}

/**
 * Sign this device into a managed child's profile from a guardian's pairing
 * link. `tokenHash` comes from `redeemPairingLink`, which has already spent the
 * link. Unlike `switchToManagedChild` there is no guardian session to park:
 * this is the child's own phone, and a guardian only ever gets back in by
 * signing in on their own device.
 */
export async function pairThisDevice(tokenHash: string): Promise<void> {
  identitySwitchInProgress = true;
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
  if (error) {
    identitySwitchInProgress = false;
    throw new Error("Couldn't open that profile. Ask your parent for a new link.");
  }
  await resetPerUserClientState();
  window.location.assign("/profile");
}

/** Read and remove the parked guardian session in one step. */
export function takeParkedGuardianSession(): ParkedGuardianSession | null {
  const parked = readParkedGuardianSession();
  clearParked();
  return parked;
}

/**
 * Return to the guardian. Signs the child's session out (revoking it) and
 * restores the parked guardian session. If that session can no longer be
 * refreshed — for example another tab rotated it — the guardian signs in
 * again and lands back in the Parent Center.
 *
 * The parked session is taken off the device before anything is signed out,
 * so nothing that watches for "signed out with a parked guardian" can start a
 * second restore in the middle of this one.
 */
export async function switchBackToGuardian(): Promise<void> {
  // Ends in a navigation on every path, so the flag is never reset here.
  identitySwitchInProgress = true;
  const parked = takeParkedGuardianSession();
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  await resetPerUserClientState();

  if (parked) {
    const { error } = await supabase.auth.setSession({
      access_token: parked.accessToken,
      refresh_token: parked.refreshToken,
    });
    if (!error) {
      window.location.assign("/parent");
      return;
    }
  }
  window.location.assign(`/auth?next=${encodeURIComponent("/parent")}`);
}

/**
 * Revoke a guardian session that was parked on this device. Used by sign-out,
 * which must end both sessions: otherwise the guardian's refresh token would
 * outlive the "Sign out" tap. The session is restored only to revoke it.
 */
export async function revokeParkedGuardianSession(parked: ParkedGuardianSession): Promise<void> {
  identitySwitchInProgress = true;
  try {
    const { error } = await supabase.auth.setSession({
      access_token: parked.accessToken,
      refresh_token: parked.refreshToken,
    });
    if (!error) await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* already invalid — nothing left to revoke */
  } finally {
    identitySwitchInProgress = false;
  }
}
