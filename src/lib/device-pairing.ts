/**
 * Device pairing: let a managed child use their own device, without a login.
 *
 * A guardian generates a short code in the Parent Center; the child's own
 * device enters it once (src/routes/devices.pair.tsx) and from then on holds
 * its own standing session for the same credential-less auth user
 * `createManagedChild` already made — not a new account, a second path to the
 * one that exists. The guardian can revoke it at any time. There is at most
 * one active pairing per child (enforced in the database): Supabase's Admin
 * API can only revoke every session a user has, never one by itself, so a
 * device *list* with precise per-row control would be misleading to offer —
 * see src/lib/device-pairing.functions.ts for how revoking actually works.
 *
 * This module is pure (safe for the client, the server, and tests) — the code
 * itself is minted and hashed server-side (src/lib/device-pairing.functions.ts),
 * which is the only place Node's `crypto` is used.
 */

export const PAIRING_CODE_LENGTH = 10;

/** "XXXXXXXXXX" -> "XXXXX-XXXXX", easier to read and to copy out loud. */
export function formatPairingCode(code: string): string {
  return code.length === PAIRING_CODE_LENGTH ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

/** Whatever a person typed (with or without the dash, any case) -> the raw code to send the server. */
export function normalizePairingCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, PAIRING_CODE_LENGTH);
}

/** The one row `managed_device_pairings` RLS lets a guardian read for their child. */
export type DevicePairingRow = {
  status: "linked" | "revoked";
  deviceLabel: string | null;
  pairedAt: string | null;
  expiresAt: string;
};

export type DevicePairingDisplayState =
  | { kind: "none" }
  | { kind: "pending"; expiresAt: string }
  | { kind: "paired"; deviceLabel: string | null; pairedAt: string };

/**
 * What the Parent Center shows, from the one row (or none) it read. An
 * unconfirmed code past its own expiry reads the same as no pairing at all —
 * same derivation `listMyMinorInvites` already does for a stale invite, so
 * there is no third "technically still a row but dead" state to explain.
 */
export function devicePairingDisplayState(
  row: DevicePairingRow | null | undefined,
  now: Date = new Date(),
): DevicePairingDisplayState {
  if (!row || row.status === "revoked") return { kind: "none" };
  if (row.pairedAt) return { kind: "paired", deviceLabel: row.deviceLabel, pairedAt: row.pairedAt };
  if (new Date(row.expiresAt).getTime() < now.getTime()) return { kind: "none" };
  return { kind: "pending", expiresAt: row.expiresAt };
}
