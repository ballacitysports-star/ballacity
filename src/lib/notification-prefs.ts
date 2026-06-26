import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";

export type NotifCategory = "approvals" | "messages" | "general";
export type NotifChannel = "inApp" | "push";

export type NotifPrefs = Record<NotifCategory, Record<NotifChannel, boolean>>;

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  approvals: { inApp: true, push: true },
  messages: { inApp: true, push: true },
  general: { inApp: true, push: false },
};

export const CATEGORY_META: Record<NotifCategory, { label: string; description: string }> = {
  approvals: { label: "Approvals", description: "Join request approved, declined, or new requests on your games." },
  messages: { label: "Messages", description: "New direct messages from players and hosts." },
  general: { label: "General updates", description: "Payments, reminders, and other activity." },
};

const KEY = "openrun.notifPrefs.v1";

export function categoryFor(type: string): NotifCategory {
  if (type === "join_request" || type === "join_approved" || type === "join_declined") return "approvals";
  if (type === "message") return "messages";
  return "general";
}

function merge(partial: Partial<NotifPrefs> | null | undefined): NotifPrefs {
  const p = partial ?? {};
  return {
    approvals: { ...DEFAULT_NOTIF_PREFS.approvals, ...(p.approvals ?? {}) },
    messages: { ...DEFAULT_NOTIF_PREFS.messages, ...(p.messages ?? {}) },
    general: { ...DEFAULT_NOTIF_PREFS.general, ...(p.general ?? {}) },
  };
}

function readLocal(): NotifPrefs {
  if (typeof window === "undefined") return DEFAULT_NOTIF_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_NOTIF_PREFS;
    return merge(JSON.parse(raw) as Partial<NotifPrefs>);
  } catch {
    return DEFAULT_NOTIF_PREFS;
  }
}

const listeners = new Set<() => void>();
let snap = JSON.stringify(readLocal());
let hydratedFor: string | null = null;

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
function getSnapshot() { return snap; }

function commit(next: NotifPrefs) {
  snap = JSON.stringify(next);
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(KEY, snap); } catch { /* ignore */ }
  }
  listeners.forEach((l) => l());
}

export function getNotifPrefs(): NotifPrefs { return JSON.parse(snap) as NotifPrefs; }

export function setNotifPref(category: NotifCategory, channel: NotifChannel, value: boolean) {
  const current = getNotifPrefs();
  const next: NotifPrefs = { ...current, [category]: { ...current[category], [channel]: value } };
  commit(next);
  void persistToBackend(next);
}

async function persistToBackend(prefs: NotifPrefs) {
  try {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    await supabase
      .from("notification_preferences" as any)
      .upsert({ user_id: uid, prefs } as any, { onConflict: "user_id" });
  } catch (e) {
    console.warn("notif prefs persist failed", e);
  }
}

export async function hydrateNotifPrefsFromBackend(userId: string) {
  if (hydratedFor === userId) return;
  hydratedFor = userId;
  try {
    const { data, error } = await supabase
      .from("notification_preferences" as any)
      .select("prefs")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) { hydratedFor = null; return; }
    if (data && (data as any).prefs) {
      commit(merge((data as any).prefs as Partial<NotifPrefs>));
    } else {
      // No row yet — seed with current local prefs so devices stay in sync going forward.
      await persistToBackend(getNotifPrefs());
    }
  } catch {
    hydratedFor = null;
  }
}

export function resetNotifPrefsHydration() { hydratedFor = null; }

export function useNotifPrefs(): NotifPrefs {
  const s = useSyncExternalStore(subscribe, getSnapshot, () => JSON.stringify(DEFAULT_NOTIF_PREFS));
  return JSON.parse(s) as NotifPrefs;
}

/** Hook to hydrate prefs from the DB when a user is signed in. Mount on the Alerts tab. */
export function useHydrateNotifPrefs(userId: string | undefined | null) {
  useEffect(() => {
    if (!userId) { resetNotifPrefsHydration(); return; }
    void hydrateNotifPrefsFromBackend(userId);
  }, [userId]);
}

export function isAllowed(type: string, channel: NotifChannel): boolean {
  return getNotifPrefs()[categoryFor(type)][channel];
}
