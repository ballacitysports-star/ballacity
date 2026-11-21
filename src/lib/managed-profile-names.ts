/**
 * Names for the people a host manages, when the profiles read leaves them out.
 *
 * Since 20261125100000 a block (either way) and a suspension hide a profile
 * row. A host still has to tell who holds a spot, waits, asked for a spot or
 * owes or is owed a payment in their game, so those screens read names from
 * profiles as before and fill the ids that came back missing from
 * `managed_profile_names`. That function answers only for people in a live
 * relationship with the caller that the person entered themselves (a current
 * game's roster or waitlist, a pending or approved request, an open payment),
 * with the name, initials and avatar (never the profile row or the username).
 * It names everyone in such a relationship, a private account included: an
 * answer that depended on visibility would tell the host "this person blocked
 * me" apart from "this person is private". For an account that is not
 * suspended, the name and initials are what `visible_avatars` gives any
 * signed-in caller anyway; a suspended player in the host's live game is
 * still named here, which `visible_avatars` would not do. Facility admins and
 * team managers are not covered: a
 * membership can be added without the person's consent, so those lists keep
 * their neutral "Member" / "Player" fallback.
 *
 * Before the migration (or after its rollback) the function does not exist:
 * nothing is filled, which is the old behaviour. Any other failure also fills
 * nothing; the screen keeps its "Player" fallback.
 */

export type ManagedProfileName = {
  id: string;
  display_name: string | null;
  /** Never returned by the function (a username would be news about a private account); kept for the screens' row shape. */
  username: null;
  avatar_initials: string | null;
  avatar_url: string | null;
};

type ManagedRow = {
  id: string;
  display_name: string | null;
  avatar_initials: string | null;
  avatar_url: string | null;
};

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
type RpcCall = (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;

/** The function's per-call limit. */
const MAX_IDS = 500;

/** True when PostgREST (PGRST202) or Postgres (42883) says the function does not exist. */
export function isMissingFunctionError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

/**
 * `managed_profile_names` for `ids`, through `client` (the browser client, or a
 * server function's client signed in as the viewer). Never throws.
 */
export async function fetchManagedProfileNames(
  client: { rpc: unknown },
  ids: readonly string[],
): Promise<ManagedProfileName[]> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, MAX_IDS);
  if (unique.length === 0) return [];
  try {
    const rpc = (client.rpc as RpcCall).bind(client);
    const { data, error } = await rpc("managed_profile_names", { _ids: unique });
    if (error || !Array.isArray(data)) return [];
    return (data as ManagedRow[]).map((r) => ({
      id: r.id,
      display_name: r.display_name ?? null,
      username: null,
      avatar_initials: r.avatar_initials ?? null,
      avatar_url: r.avatar_url ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * `rows` (a profiles read for `ids`) plus a name for each id the read left out
 * that the caller manages. Asks the database only when an id is missing.
 */
export async function withManagedProfileNames<T extends { id: string }>(
  client: { rpc: unknown },
  ids: readonly string[],
  rows: readonly T[] | null | undefined,
): Promise<Array<T | ManagedProfileName>> {
  const have = new Set((rows ?? []).map((r) => r.id));
  const missing = ids.filter((id) => !have.has(id));
  const filled = missing.length ? await fetchManagedProfileNames(client, missing) : [];
  return [...(rows ?? []), ...filled.filter((r) => !have.has(r.id))];
}

/** The name fields a host's screens show for one person. */
export type ProfileNameBits = {
  display_name: string | null;
  username: string | null;
  avatar_initials: string | null;
  avatar_url: string | null;
};

type ProfileRead = { data: unknown };
type ProfilesQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => { maybeSingle: () => PromiseLike<ProfileRead> };
  };
};

/**
 * One person's name for a host's screen: their profile row, or, when a block or a
 * suspension hides it, `managed_profile_names` (null when neither answers). Used
 * where a host reviews one person at a time (request rows, roster rows, the
 * payment verification queue). Never throws.
 */
export async function fetchProfileNameBits(
  client: { from: unknown; rpc: unknown },
  id: string,
): Promise<ProfileNameBits | null> {
  if (!id) return null;
  try {
    const from = (client.from as (table: string) => ProfilesQuery).bind(client);
    const { data } = await from("profiles")
      .select("display_name, username, avatar_initials, avatar_url")
      .eq("id", id)
      .maybeSingle();
    if (data) return data as ProfileNameBits;
  } catch {
    // fall through to the managed name
  }
  const [managed] = await fetchManagedProfileNames(client, [id]);
  if (!managed) return null;
  const { display_name, username, avatar_initials, avatar_url } = managed;
  return { display_name, username, avatar_initials, avatar_url };
}
