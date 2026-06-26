import { useSyncExternalStore } from "react";

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

function read(): NotifPrefs {
  if (typeof window === "undefined") return DEFAULT_NOTIF_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_NOTIF_PREFS;
    const parsed = JSON.parse(raw) as Partial<NotifPrefs>;
    return {
      approvals: { ...DEFAULT_NOTIF_PREFS.approvals, ...(parsed.approvals ?? {}) },
      messages: { ...DEFAULT_NOTIF_PREFS.messages, ...(parsed.messages ?? {}) },
      general: { ...DEFAULT_NOTIF_PREFS.general, ...(parsed.general ?? {}) },
    };
  } catch {
    return DEFAULT_NOTIF_PREFS;
  }
}

const listeners = new Set<() => void>();
let snap = JSON.stringify(read());

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
function getSnapshot() { return snap; }

export function getNotifPrefs(): NotifPrefs { return JSON.parse(snap) as NotifPrefs; }

export function setNotifPref(category: NotifCategory, channel: NotifChannel, value: boolean) {
  const current = getNotifPrefs();
  const next: NotifPrefs = { ...current, [category]: { ...current[category], [channel]: value } };
  snap = JSON.stringify(next);
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(KEY, snap); } catch { /* ignore */ }
  }
  listeners.forEach((l) => l());
}

export function useNotifPrefs(): NotifPrefs {
  const s = useSyncExternalStore(subscribe, getSnapshot, () => JSON.stringify(DEFAULT_NOTIF_PREFS));
  return JSON.parse(s) as NotifPrefs;
}

export function isAllowed(type: string, channel: NotifChannel): boolean {
  return getNotifPrefs()[categoryFor(type)][channel];
}
