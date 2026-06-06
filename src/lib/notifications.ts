import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export async function createNotification(input: {
  user_id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}) {
  const { error } = await supabase.from("notifications" as any).insert(input as any);
  if (error) console.warn("notification insert failed", error.message);
}

export async function listMyNotifications(): Promise<Notification[]> {
  const { data, error } = await supabase
    .from("notifications" as any)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as Notification[];
}

export async function markNotificationRead(id: string) {
  await supabase.from("notifications" as any).update({ read_at: new Date().toISOString() } as any).eq("id", id);
}

export async function markAllNotificationsRead() {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase
    .from("notifications" as any)
    .update({ read_at: new Date().toISOString() } as any)
    .eq("user_id", u.user.id)
    .is("read_at", null);
}

export function useUnreadNotificationCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) { setCount(0); return; }
    let cancelled = false;
    const fetchCount = async () => {
      const { count: c } = await supabase
        .from("notifications" as any)
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("read_at", null);
      if (!cancelled) setCount(c ?? 0);
    };
    fetchCount();

    const channel = supabase
      .channel(`notif-count-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, fetchCount)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [user?.id]);

  return count;
}
