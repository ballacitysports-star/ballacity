import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { fetchInboxMessageCounts } from "@/lib/messages";
import { useUnreadNotificationCount } from "@/lib/notifications";

/**
 * The number on the Inbox tab: what is actually waiting in the Inbox.
 *
 * It used to count unread notifications, which includes a "new message" row per
 * message that was never cleared by reading the thread, and misses messages for
 * anyone who muted message notifications. Now: unread messages and real message
 * requests from the conversations themselves, plus unread alerts that are not
 * message notifications.
 */
export function useInboxBadgeCount(scope = "nav-"): number {
  const { user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id ?? null;
  const alerts = useUnreadNotificationCount(scope, { excludeType: "message" });

  const counts = useQuery({
    queryKey: ["inbox-badge", uid],
    enabled: !!uid,
    staleTime: 30_000,
    retry: false,
    queryFn: () => fetchInboxMessageCounts(uid!),
  });

  useEffect(() => {
    if (!uid) return;
    const refresh = () => void qc.invalidateQueries({ queryKey: ["inbox-badge", uid] });
    const channel = supabase
      .channel(`inbox-badge-${uid}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, refresh)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations" },
        refresh,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [uid, qc]);

  return alerts + (counts.data?.unread ?? 0) + (counts.data?.requests ?? 0);
}
