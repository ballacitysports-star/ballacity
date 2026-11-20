// Blocks for public server functions that read with the service role (no viewer in the database), such as the
// player card. The profile read rule (20261126100000, docs/privacy/profile-blocks-and-suspension.md) hides a profile
// from anyone blocked either way; these give a service-role reader the same answer for the signed-in viewer.

type AdminClient = {
  auth: {
    getClaims: (
      jwt?: string,
    ) => Promise<{ data: { claims?: { sub?: string } } | null; error: unknown }>;
  };
  rpc: (fn: never, args?: never) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * The signed-in viewer of the current request, or null when there is none: no request, no bearer token, or a token
 * that does not verify. Never throws. The browser attaches the token to every server function call when signed in
 * (attachSupabaseAuth in src/start.ts).
 */
export async function optionalViewerId(admin: AdminClient): Promise<string | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const header = getRequest()?.headers?.get("authorization") ?? "";
    if (!header.startsWith("Bearer ")) return null;
    const token = header.slice("Bearer ".length).trim();
    if (!token) return null;
    const { data, error } = await admin.auth.getClaims(token);
    const sub = data?.claims?.sub;
    return !error && typeof sub === "string" && sub ? sub : null;
  } catch {
    return null;
  }
}

/**
 * Whether `owner` is hidden from `viewer` by a block in either direction, the way the profile read rule decides it:
 * staff (admin, moderator, superadmin) are not hidden from anyone. Asked with the service role, which gets the true
 * answer from the public helper wrappers. A failed lookup counts as blocked (fail closed).
 */
export async function hiddenByBlock(
  admin: AdminClient,
  viewer: string,
  owner: string,
): Promise<boolean> {
  if (viewer === owner) return false;
  const blocked = await admin.rpc(
    "blocks_exist_between" as never,
    { _a: viewer, _b: owner } as never,
  );
  if (blocked.error) return true;
  if (blocked.data !== true) return false;
  const staff = await admin.rpc("is_moderator" as never, { _user_id: viewer } as never);
  return !(staff.error == null && staff.data === true);
}
