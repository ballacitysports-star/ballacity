import type { RealtimeChannel, RealtimeChannelOptions } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Realtime channels whose SUBSCRIBED means the table's changes are actually flowing.
 *
 * By default realtime-js reports SUBSCRIBED as soon as the channel has joined, which is before the
 * server streams that table's changes. In a sandbox probe SUBSCRIBED came at 821 ms but the server
 * only logged "Subscribed to PostgreSQL" at 3561 ms, so a change made in between was never
 * delivered. With `postgres_changes_options: { wait: true }` the server holds SUBSCRIBED until the
 * changes are live (in the probe both came at 253 ms). The option also extends the join timeout so
 * it outlasts the held reply, and other pushes on the channel without their own timeout inherit it.
 *
 * Never use liveChannel for a channel that binds any table outside the supabase_realtime
 * publication (for example notification_delivery_log, trainer_org_join_requests or subscriptions).
 * With wait the server refuses that join (CHANNEL_ERROR RealtimeDisabledForConfiguration) and the
 * client rejoins about every 3 s forever, so the channel never delivers anything. Use plain
 * supabase.channel for those.
 *
 * wait alone fixes nothing: a load sent on mount may have been answered before the changes were
 * live. Pair the channel with onLive and re-read the data on every SUBSCRIBED.
 */
export function liveChannel(name: string, opts?: RealtimeChannelOptions): RealtimeChannel {
  // Build a new object so the caller's options are never changed, and copy only the keys the
  // caller passed, so no-opts gives exactly { config: { postgres_changes_options: { wait: true } } }.
  const merged: RealtimeChannelOptions = {
    ...opts,
    config: {
      ...opts?.config,
      postgres_changes_options: { ...opts?.config?.postgres_changes_options, wait: true },
    },
  };
  return supabase.channel(name, merged);
}

/** A subscribe status handler, as realtime-js passes it: the status, and the error when there is one. */
export type ChannelStatusHandler = (status: string, err?: Error) => void;

/**
 * A subscribe status handler that runs `callback` on every SUBSCRIBED, for use as
 * `.subscribe(onLive(reload))`.
 *
 * The callback must re-read the data from the server, not apply a delta. It runs on the first
 * SUBSCRIBED too, since a load sent on mount may have been answered before changes were live, and
 * again on each rejoin after a drop, since changes made while the channel was down are not replayed.
 * If loads can overlap and each replaces state wholesale, guard them so the newest one sent wins.
 *
 * `onStatus`, when given, gets every status (and its error) before `callback` runs, for sites that
 * already act on the status, such as showing whether the channel is live.
 */
export function onLive(
  callback: () => void,
  onStatus?: ChannelStatusHandler,
): ChannelStatusHandler {
  return (status, err) => {
    onStatus?.(status, err);
    if (status === "SUBSCRIBED") callback();
  };
}
