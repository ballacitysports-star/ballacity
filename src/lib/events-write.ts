/**
 * P2-1 stage 4a: tryout and clinic sign-ups and cancellations through `events`, behind the
 * `events_v2_writes` switch (separate from the `events_v2` read switch).
 *
 * When the switch is on and the post has an events copy the caller can read, the sign-up goes
 * through register_for_event / cancel_event_registration. For a copied post those keep exactly
 * today's rules (owner decision 2026-11-07: no age check), and the database writes the result
 * back to tryout_rsvps and spots_taken, so everything that reads the old tables keeps working.
 *
 * Otherwise (switch off, missing or unreadable, no copy, or the copy lookup failed) the caller
 * uses the old RPCs, which the stage 2 mirror copies to events. A failure of the events RPC
 * itself is reported, never retried on the old path: the sign-up may have half-happened.
 */
import { isAppSwitchOn, type EventsClient } from "@/lib/events-read";

export const EVENTS_V2_WRITES_SETTING_KEY = "events_v2_writes";

export type EventsWrite = { handled: false } | { handled: true; error: string | null };

/** The events copy of a post, if the switch is on and the caller can read it. Never throws. */
export async function copiedEventForWrites(
  client: EventsClient,
  postId: string,
): Promise<string | null> {
  if (!(await isAppSwitchOn(client, EVENTS_V2_WRITES_SETTING_KEY))) return null;
  try {
    const { data, error } = await client
      .from("events")
      .select("id")
      .eq("legacy_post_id", postId)
      .maybeSingle();
    if (error || !data) return null;
    return String((data as { id: string }).id);
  } catch {
    return null;
  }
}

export async function signUpThroughEvents(
  client: EventsClient,
  postId: string,
  args: { onBehalfOf: string | null; waiverId: string | null; attested: boolean },
): Promise<EventsWrite> {
  const eventId = await copiedEventForWrites(client, postId);
  if (!eventId) return { handled: false };
  const { error } = await client.rpc("register_for_event", {
    _event: eventId,
    _on_behalf_of: args.onBehalfOf,
    _waiver_id: args.waiverId,
    _attested: args.attested,
  });
  return { handled: true, error: error ? error.message : null };
}

export async function cancelThroughEvents(
  client: EventsClient,
  postId: string,
  onBehalfOf: string | null,
): Promise<EventsWrite> {
  const eventId = await copiedEventForWrites(client, postId);
  if (!eventId) return { handled: false };
  const { error } = await client.rpc("cancel_event_registration", {
    _event: eventId,
    _user: onBehalfOf,
  });
  return { handled: true, error: error ? error.message : null };
}
